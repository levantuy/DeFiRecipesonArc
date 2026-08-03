export const RecipeType = {
  AUTO_COMPOUNDER: 'AUTO_COMPOUNDER',
  RECURRING_DCA: 'RECURRING_DCA',
  SMART_YIELD_REBALANCER: 'SMART_YIELD_REBALANCER',
  SAFETY_NET: 'SAFETY_NET',
  SAVINGS_STREAM: 'SAVINGS_STREAM',
} as const;

export type RecipeType = (typeof RecipeType)[keyof typeof RecipeType];

export const RecipeStatus = {
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;

export type RecipeStatus = (typeof RecipeStatus)[keyof typeof RecipeStatus];

export const SwapProvider = {
  ARC_APP_KIT_SWAP: 'ARC_APP_KIT_SWAP',
} as const;

export type SwapProvider = (typeof SwapProvider)[keyof typeof SwapProvider];

export const ExecutionStatus = {
  SIMULATING: 'SIMULATING',
  SUBMITTED: 'SUBMITTED',
  CONFIRMED: 'CONFIRMED',
  SIMULATION_FAILED: 'SIMULATION_FAILED',
  REVERTED: 'REVERTED',
} as const;

export type ExecutionStatus = (typeof ExecutionStatus)[keyof typeof ExecutionStatus];

export type JsonObject = Record<string, unknown>;

export interface ActiveRecipeRecord {
  id: string;
  userAddress: string;
  recipeType: RecipeType;
  status: RecipeStatus;
  targetProtocol: string | null;
  swapProvider: SwapProvider | null;
  parametersJson: JsonObject;
  lastExecutedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExecutionLogRecord {
  id: string;
  activeRecipeId: string;
  status: ExecutionStatus;
  txHash: string | null;
  gasUsedUsdc: string | null;
  simulatedAt: Date;
  executedAt: Date | null;
  errorMessage: string | null;
}

export interface ExecutionLogWithRecipeRecord extends ExecutionLogRecord {
  recipeId: string;
  recipeType: RecipeType;
  recipeUserAddress: string;
}
