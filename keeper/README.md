# Keeper Service Notes

## Chế độ Redis queue (tùy chọn qua .env)

Keeper hỗ trợ 2 chế độ chạy qua biến môi trường `KEEPER_USE_REDIS_QUEUE`:

1. `KEEPER_USE_REDIS_QUEUE=true` (khuyến nghị cho production)
   - Cron scheduler đẩy job vào BullMQ.
   - Xác nhận giao dịch chạy qua queue xác nhận (`tx-confirmation-queue`).
   - Cần `REDIS_URL` hợp lệ.

2. `KEEPER_USE_REDIS_QUEUE=false` (phù hợp local/dev hoặc chế độ suy giảm)
   - Cron scheduler thực thi trực tiếp, không cần Redis.
   - Nếu `KEEPER_SYNC_CONFIRMATION_IN_HOT_PATH=false`, keeper tự động fallback sang xác nhận đồng bộ để tránh mất trạng thái xác nhận tx.
   - Không có durability/retry ở tầng queue, không phù hợp cho tải production.

Ví dụ `.env`:

```bash
KEEPER_USE_REDIS_QUEUE=true
REDIS_URL=redis://localhost:6379
```

```bash
KEEPER_USE_REDIS_QUEUE=false
# REDIS_URL có thể bỏ qua trong chế độ này
```

## Database migrations (SQL runner)

Legacy ORM integration has been removed from keeper runtime and package scripts.
Migrations are executed via SQL files in `db-migrations/migrations` using:

```bash
npm run db:migrate
```

### Safety checklist for staging -> production

1. Ensure `DATABASE_URL` points to the target environment.
2. Run `npm run db:migrate` in staging first.
3. Validate API and scheduler behavior in staging:
   - `POST /recipes/register`
   - `POST /recipes/status`
   - `GET /recipes/logs`
   - `GET /healthz`
4. Promote the same migration set to production.

### Migration tracking

The SQL runner stores applied migrations in `_sql_migrations` with checksum verification.
If a migration checksum changes after being applied, the runner will fail to prevent drift.

## DCA routing policy (partial migration)

RECURRING_DCA now uses LI.FI route resolution on Arc Testnet by default:

1. Keeper resolves route + transaction payload through `dcaSwapRouteClient` (LI.FI, Arc-only).
2. Keeper executes the returned `targetProtocolAddress` and `callData` directly.
3. If LI.FI returns `No route available`, the recipe is skipped for that cycle and logged as action-required.

Runtime notes:

- Default DCA provider is `ARC_LIFI_SWAP`.
- To use Arc App Kit swap flow (`https://docs.arc.io/app-kit/swap`) from `.env`, set `DCA_ROUTE_PROVIDER=APP_KIT_SWAP` (or `ARC_APP_KIT_SWAP`).
- Optional internal fallback can be enabled with `DCA_ROUTE_ALLOW_APP_KIT_FALLBACK=true`.
- Fallback scope is Arc Testnet only. Keeper never switches DCA route resolution to another chain.
- If LI.FI does not support Arc in the current environment, route resolution fails with explicit error.
- App Kit credentials support both legacy and current names: `ARC_APP_KIT_API_KEY` (preferred) or `ARC_APP_KIT_KEY` (legacy). Only a `KIT_KEY:<id>:<secret>` value is sent as a bearer token; anything else is ignored and the request runs in permissionless mode.

### App Kit swap execution model

The Circle Stablecoin Service does not return a plain `to`/`data` pair. It returns signed
`transaction.executionParams` plus a `signature` that must be submitted as a single
`execute(ExecutionParams,TokenInput[],bytes)` call to the Circle adapter contract
(`0xbbd70b01a1cabc96d5b7b129ae1aaabdf50dd40b` on Arc Testnet, selector `0xaa3e079c`).
Replaying the inner `instructions` individually only runs the fee leg and never performs the swap.

Before the first App Kit DCA run, whitelist that entrypoint once from the RecipeGuardrail owner wallet:

```bash
node scripts/whitelist-appkit-swap-adapter.js
```

Users must keep their USDC allowance for `SHARED_EXECUTOR_PROXY_ADDRESS`, which pulls the
per-execution amount and approves the adapter before the call.

Legacy fallback swap construction (e.g. local `swapExactTokensForTokens` callData assembly from configured `targetProtocol`) is intentionally disabled to keep runtime behavior deterministic.

API contract for `POST /recipes/register` with `recipeType=RECURRING_DCA`:

- `swapProvider` defaults to `ARC_LIFI_SWAP`.
- `swapProvider=ARC_APP_KIT_SWAP` is accepted for legacy fallback scenarios.
- `targetProtocol` is not accepted.

## Endpoint smoke and cleanup for staging pipeline

Run smoke test and cleanup in one command:

```bash
npm run pipeline:smoke-cleanup
```

This command executes:

1. `scripts/smoke-endpoints.js`
2. `scripts/cleanup-test-data.js`

Environment options:

- `KEEPER_BASE_URL`: target keeper API base URL (default `http://localhost:8787`)
- `SMOKE_USER_ADDRESS`: user address used by smoke test
- `SMOKE_LOG_LIMIT`: logs endpoint limit for smoke verification
- `CLEANUP_USER_ADDRESS`: user address to cleanup (defaults to smoke test address)
- `PIPELINE_RUN_CLEANUP`: set `false` to skip cleanup
- `PIPELINE_CLEANUP_ON_FAILURE`: set `false` to skip cleanup if smoke fails

## API security hardening (P0)

Keeper now enforces security controls on protected endpoints (`/recipes/*`, `/metrics`):

1. Bearer token authentication (recommended required in production).
2. CORS allowlist (no wildcard origin).
3. Per-IP fixed-window rate limiting.

Environment variables:

- `KEEPER_API_REQUIRE_AUTH`: `true`/`false` (defaults to `true` in production mode).
- `KEEPER_API_AUTH_TOKEN`: required when auth is enabled.
- `KEEPER_CORS_ALLOWED_ORIGINS`: comma-separated origins.
- `KEEPER_API_RATE_LIMIT_WINDOW_MS`: rate-limit window duration.
- `KEEPER_API_RATE_LIMIT_MAX_REQUESTS`: max requests per IP in each window.
- `KEEPER_INTERNAL_ONLY_ENFORCED`: app-layer enforcement for internal-only endpoints.
- `KEEPER_INTERNAL_ONLY_PATHS`: comma-separated paths restricted to internal network.

Ingress/reverse-proxy policy (required in production):

- Keep `GET /healthz` and `GET /metrics` internal-only (cluster/private network).
- Expose `POST /recipes/register`, `POST /recipes/status`, `POST /recipes/dca/allowance-precheck`, `GET /recipes/logs` only through authenticated ingress.

Example Nginx policy snippet:

```nginx
location /healthz {
   allow 10.0.0.0/8;
   allow 172.16.0.0/12;
   allow 192.168.0.0/16;
   deny all;
   proxy_pass http://keeper_upstream;
}

location /metrics {
   allow 10.0.0.0/8;
   allow 172.16.0.0/12;
   allow 192.168.0.0/16;
   deny all;
   proxy_pass http://keeper_upstream;
}
```

Reference file: `deploy/nginx/keeper-internal-only.conf`.

Example call to protected endpoint:

```bash
curl -X POST http://localhost:8787/recipes/register \
   -H "Authorization: Bearer $KEEPER_API_AUTH_TOKEN" \
   -H "Content-Type: application/json" \
   -d '{"userAddress":"0x...","recipeType":"RECURRING_DCA"}'
```
