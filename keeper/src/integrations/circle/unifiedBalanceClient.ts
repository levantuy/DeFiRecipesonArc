import {
  UnifiedBalanceProvider,
  UnifiedBalanceSnapshot,
  UnifiedBalanceSpendRequest,
  UnifiedBalanceSpendResult,
} from './types';
import { assertUnifiedBalanceEnabled } from './featureFlags';

export class UnifiedBalanceClient {
  constructor(private readonly provider: UnifiedBalanceProvider) {}

  async getBalances(depositorAddress: `0x${string}`): Promise<UnifiedBalanceSnapshot> {
    assertUnifiedBalanceEnabled();
    return this.provider.getBalances(depositorAddress);
  }

  async spend(request: UnifiedBalanceSpendRequest): Promise<UnifiedBalanceSpendResult> {
    assertUnifiedBalanceEnabled();

    if (Number(request.amount) <= 0) {
      throw new Error('Unified balance spend amount must be greater than zero.');
    }

    if (request.sourceChain === request.destinationChain) {
      throw new Error('Unified balance spend requires different source and destination chains.');
    }

    return this.provider.spend(request);
  }
}
