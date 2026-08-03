# Feature X Production Runbook

## Scope
Feature X in this release covers recipe delegation lifecycle:
- Pre-flight simulation
- Activate delegation
- Pause / resume delegation
- Revoke delegation
- Keeper execution safety controls (retry, timeout, healthcheck)

## Required Environment Variables

### Web
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`

### Keeper
- `DATABASE_URL`
- `KEEPER_PRIVATE_KEY` (32-byte hex string, `0x` prefixed)
- `ARC_TESTNET_RPC_URL` (optional, default `https://rpc.testnet.arc.network`)
- `REDIS_URL` (optional, default `redis://localhost:6379`)
- `KEEPER_HEALTH_PORT` (optional, default `8787`)
- `ARC_RPC_TIMEOUT_MS` (optional, default `15000`)
- `ARC_RPC_RETRY_COUNT` (optional, default `2`)
- `SCHEDULER_SIMULATION_BACKOFF_MS` (optional, default `30000`)
- `KEEPER_TX_RETRY_MAX_ATTEMPTS` (optional, default `7`)
- `KEEPER_TX_RECEIPT_TIMEOUT_MS` (optional, default `10000`)
- `KEEPER_TX_CONFIRM_MAX_ATTEMPTS` (optional, default `8`)
- `KEEPER_TX_CONFIRM_RETRY_DELAY_MS` (optional, default `4000`)
- `KEEPER_SYNC_CONFIRMATION_IN_HOT_PATH` (optional, default `false`)
- `KEEPER_SIMULATION_ESTIMATE_GAS` (optional, default `false`)
- `ENABLE_UNIFIED_BALANCE` (optional, default `false`)
- `ENABLE_GATEWAY_FORWARDER` (optional, default `false`)
- `REDIS_RETRY_MAX_DELAY_MS` (optional, default `10000`)

## Build & Validation

### Contracts
1. `cd contracts`
2. `forge build`
3. `forge test`

### Keeper
1. `cd keeper`
2. `pnpm prisma:generate`
3. `pnpm build`
4. `pnpm test`

5. `pnpm alerts:check` (requires keeper `/metrics` endpoint reachable)
### Web
1. `cd web`
2. `pnpm lint`
3. `pnpm build`
- `CIRCLE_CLIENT_KEY` / `CIRCLE_CLIENT_URL` (required only when `ENABLE_UNIFIED_BALANCE=true`)
- `GATEWAY_API_BASE_URL` / `GATEWAY_TRANSFER_PATH` (required only when `ENABLE_GATEWAY_FORWARDER=true`)
   - `pnpm start`
### Alert Thresholds (optional)
- `ALERT_CRON_CYCLE_P95_MS`
- `ALERT_RPC_CALLS_PER_CYCLE_P95`
- `ALERT_SIM_RATE_LIMIT_FAILURE_RATE`
- `ALERT_ENQUEUE_TO_SUBMITTED_P95_MS`
- `ALERT_ENQUEUE_TO_CONFIRMED_P95_MS`

## Smoke Test (Production-like)
1. Connect wallet on Arc Testnet (5042002).
2. Open a recipe and confirm simulation modal details.
3. Activate delegation and verify tx hash link renders.
4. Pause and resume the delegation.
5. Revoke delegation and verify status becomes `revoked`.
6. Confirm keeper health endpoint responds.

## Rollback Plan
1. Pause keeper service instances.
2. Revert web deployment to previous stable artifact.
3. Revert keeper deployment to previous stable artifact.
4. If required, restore DB from last validated backup snapshot.
5. Re-run smoke tests and `/healthz` checks before reopening traffic.

## Operational Notes
- On Windows, `pnpm prisma:generate` can fail with EPERM if a `ts-node-dev` keeper process is running and holding Prisma engine files. Stop dev keeper processes before generating Prisma client.
- Keep `KEEPER_PRIVATE_KEY` in secret storage only, never in source control.
- Confirmation now runs asynchronously in keeper by default. Set `KEEPER_SYNC_CONFIRMATION_IN_HOT_PATH=true` only for debugging or one-off diagnostics.
- Keep `ENABLE_UNIFIED_BALANCE` and `ENABLE_GATEWAY_FORWARDER` disabled until integration credentials and route policies are validated in staging.
