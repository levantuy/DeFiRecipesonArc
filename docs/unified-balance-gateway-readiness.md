# Unified Balance & Gateway Readiness

## Scope
This document captures non-breaking readiness work for future Circle Unified Balance and Gateway activation.

## Implemented Modules
- `keeper/src/integrations/circle/unifiedBalanceClient.ts`
- `keeper/src/integrations/circle/gatewayClient.ts`
- `keeper/src/integrations/circle/featureFlags.ts`
- `keeper/src/integrations/circle/types.ts`
- `keeper/src/integrations/circle/providers.ts`
- `keeper/src/integrations/circle/factory.ts`

## Feature Flags
- `ENABLE_UNIFIED_BALANCE=false` by default
- `ENABLE_GATEWAY_FORWARDER=false` by default

## Behavior
- When flags are disabled, calls fail fast with explicit error messages.
- Validation guards prevent invalid transfer/spend requests before provider invocation.
- Unified Balance provider uses Circle App Kit via runtime-configured `CIRCLE_CLIENT_KEY` and `CIRCLE_CLIENT_URL`.
- Gateway provider uses HTTP endpoint configured by `GATEWAY_API_BASE_URL` + `GATEWAY_TRANSFER_PATH`.
- Existing keeper and frontend flows remain unchanged unless flags are enabled.

## Test Coverage
- `keeper/src/__tests__/circleIntegration.test.ts`
- Happy paths:
  - Unified balance spend with enabled flag
- Failure paths:
  - Unified balance disabled
  - Gateway disabled
  - Gateway invalid amount

## Enablement Steps (Staging First)
1. Configure provider adapters and credentials through environment variables only.
2. Enable `ENABLE_UNIFIED_BALANCE=true` in staging, run keeper tests and smoke flows.
3. Enable `ENABLE_GATEWAY_FORWARDER=true` in staging for routed transfer tests.
4. Keep both flags disabled in production until staging SLO and error budgets are met.
