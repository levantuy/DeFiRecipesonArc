# Keeper Service Notes

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
