export interface UnifiedBalanceAllocation {
  chain: string;
  confirmedBalance: string;
}

export interface UnifiedBalanceSnapshot {
  token: 'USDC';
  totalConfirmedBalance: string;
  breakdown: UnifiedBalanceAllocation[];
}

export interface UnifiedBalanceSpendRequest {
  amount: string;
  sourceChain: string;
  destinationChain: string;
  recipientAddress: `0x${string}`;
}

export interface UnifiedBalanceSpendResult {
  transferId: string;
  txHash: `0x${string}`;
  explorerUrl: string;
}

export interface GatewayTransferRequest {
  amount: string;
  sourceDomain: number;
  destinationDomain: number;
  destinationRecipient: string;
}

export interface GatewayTransferResult {
  burnIntentId: string;
  destinationTxHash?: string;
}

export interface UnifiedBalanceProvider {
  getBalances(depositorAddress: `0x${string}`): Promise<UnifiedBalanceSnapshot>;
  spend(request: UnifiedBalanceSpendRequest): Promise<UnifiedBalanceSpendResult>;
}

export interface GatewayProvider {
  transfer(request: GatewayTransferRequest): Promise<GatewayTransferResult>;
}
