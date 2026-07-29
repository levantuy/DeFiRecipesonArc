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
- `KEEPER_TX_RETRY_MAX_ATTEMPTS` (optional, default `3`)
- `KEEPER_TX_RECEIPT_TIMEOUT_MS` (optional, default `10000`)
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

### Web
1. `cd web`
2. `pnpm lint`
3. `pnpm build`

## Deploy Steps
1. Deploy contracts and verify addresses.
2. Update keeper contract env vars:
   - `SESSION_KEY_REGISTRY_ADDRESS`
   - `RECIPE_GUARDRAIL_ADDRESS`
   - `SHARED_EXECUTOR_PROXY_ADDRESS`
3. Run DB migration in keeper:
   - `pnpm prisma:migrate`
4. Start keeper:
   - `pnpm start`
5. Health probe:
   - `GET /healthz` must return HTTP 200.
6. Start web:
   - `pnpm start`

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
