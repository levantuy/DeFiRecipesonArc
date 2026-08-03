import { RUNTIME_CONFIG } from '../../config/runtime';

export function isUnifiedBalanceEnabled(): boolean {
  return RUNTIME_CONFIG.enableUnifiedBalance;
}

export function isGatewayForwarderEnabled(): boolean {
  return RUNTIME_CONFIG.enableGatewayForwarder;
}

export function assertUnifiedBalanceEnabled() {
  if (!isUnifiedBalanceEnabled()) {
    throw new Error('Unified balance integration is disabled. Set ENABLE_UNIFIED_BALANCE=true to enable.');
  }
}

export function assertGatewayForwarderEnabled() {
  if (!isGatewayForwarderEnabled()) {
    throw new Error('Gateway forwarder integration is disabled. Set ENABLE_GATEWAY_FORWARDER=true to enable.');
  }
}
