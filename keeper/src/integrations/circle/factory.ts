import { GatewayClient } from './gatewayClient';
import { UnifiedBalanceClient } from './unifiedBalanceClient';
import { AppKitUnifiedBalanceProvider, HttpGatewayProvider } from './providers';

export function createUnifiedBalanceClientFromRuntime(): UnifiedBalanceClient {
  return new UnifiedBalanceClient(new AppKitUnifiedBalanceProvider());
}

export function createGatewayClientFromRuntime(): GatewayClient {
  return new GatewayClient(new HttpGatewayProvider());
}
