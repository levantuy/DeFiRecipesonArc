# Keeper & Wallet Flow Baseline Metrics (2026-08-02)

## Method
- Source: `keeper` benchmark command `npm run benchmark:perf`
- Baseline profile: legacy synchronous confirmation + duplicate simulation model.
- Note: This benchmark is deterministic and replayable for relative comparison.

## Baseline KPIs
- Cron cycle duration: p50 `1674ms`, p95 `3352ms`
- RPC calls per recipe cycle: p50 `180`, p95 `216`
- Simulation fail rate caused by rate limit: `17.5%`
- Queue lead time enqueue -> submitted: p50 `3418ms`, p95 `4527ms`
- Queue lead time enqueue -> confirmed: p50 `7677ms`, p95 `9570ms`

## Baseline Risks
- Worker slot blocked by synchronous receipt wait.
- Redundant simulation in scheduler and worker increases RPC pressure.
- High confirmation wait variance under RPC throttling.
