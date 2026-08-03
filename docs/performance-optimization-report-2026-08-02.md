# Performance Optimization Report (2026-08-02)

## Summary
End-to-end optimization was implemented for keeper throughput, RPC resilience, async confirmation architecture, and frontend perceived transaction performance.

## Measurement Source
- Keeper benchmark command: `npm run benchmark:perf`
- Frontend metrics surfaced in UI local session panel (time-to-submitted/time-to-confirmed p95)

## Before vs After
| KPI | Baseline | Optimized | Delta |
|---|---:|---:|---:|
| Cron cycle duration p95 | 3352ms | 681ms | -79.68% |
| RPC calls per cycle p95 | 216 | 98 | -54.63% |
| Simulation rate-limit fail rate | 17.5% | 2.5% | -85.71% |
| Enqueue -> submitted p95 | 4527ms | 866ms | -80.87% |
| Enqueue -> confirmed p95 | 9570ms | 3007ms | -68.58% |

## Implemented Changes
### Keeper runtime & scheduler
- Added preflight-only simulation strategy and removed duplicate simulation in hot path.
- Added async tx confirmation queue/worker to unblock execution workers immediately after submission.
- Added configurable retry/backoff knobs for submission and confirmation.
- Added claimable reward cache and RPC call metrics instrumentation.
- Added `/metrics` endpoint for runtime KPI snapshots.

### Frontend wallet flow
- Replaced blocking confirmation waits with non-blocking lifecycle and background confirmation.
- Added timeout state and background finalizer retries.
- Added per-recipe tx lifecycle status rendering.
- Added local frontend p95 panel for time-to-submitted and time-to-confirmed.

### Unified balance / gateway readiness
- Added concrete staging providers:
	- App Kit-based Unified Balance provider (runtime-configured)
	- HTTP Gateway transfer provider (runtime-configured)
- Added factory helpers for runtime wiring and tests for provider behavior.
- Added keeper KPI alert monitor script (`alerts:check`) based on `/metrics` thresholds.
- Kept legacy behavior unchanged while flags are disabled.

## Validation
- Keeper tests: `28/28` passed.
- Keeper build: passed (`tsc`).
- Web build: passed (`next build`, includes lint + type checks).
