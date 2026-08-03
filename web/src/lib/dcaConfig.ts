import { parseUnits } from 'viem';

export type DcaExecutionMode = 'PREFUND' | 'PULL';

export interface DcaActivationConfig {
  totalDcaBudgetUsdc: string;
  perExecutionUsdc: string;
  executionMode: DcaExecutionMode;
}

export interface ParsedDcaActivationConfig {
  totalDcaBudgetBaseUnits: bigint;
  perExecutionBaseUnits: bigint;
  executionMode: DcaExecutionMode;
}

const USDC_AMOUNT_REGEX = /^\d+(\.\d{1,6})?$/;

export function normalizeDcaExecutionMode(value: unknown): DcaExecutionMode {
  if (value === 'PREFUND') {
    return 'PREFUND';
  }
  return 'PULL';
}

export function parseUsdcAmountToBaseUnits(input: string, fieldName: string): bigint {
  const normalized = input.trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  if (!USDC_AMOUNT_REGEX.test(normalized)) {
    throw new Error(`${fieldName} must be numeric with up to 6 decimals.`);
  }

  const amountBaseUnits = parseUnits(normalized, 6);
  if (amountBaseUnits <= 0n) {
    throw new Error(`${fieldName} must be greater than 0.`);
  }

  return amountBaseUnits;
}

export function estimateDcaRuns(totalBudgetBaseUnits: bigint, perExecutionBaseUnits: bigint): bigint {
  if (perExecutionBaseUnits <= 0n) {
    return 0n;
  }
  return totalBudgetBaseUnits / perExecutionBaseUnits;
}

export function parseDcaActivationConfig(config: DcaActivationConfig): ParsedDcaActivationConfig {
  const totalDcaBudgetBaseUnits = parseUsdcAmountToBaseUnits(config.totalDcaBudgetUsdc, 'Total DCA Budget');
  const perExecutionBaseUnits = parseUsdcAmountToBaseUnits(config.perExecutionUsdc, 'Per Execution Amount');

  if (perExecutionBaseUnits > totalDcaBudgetBaseUnits) {
    throw new Error('Per Execution Amount must be less than or equal to Total DCA Budget.');
  }

  return {
    totalDcaBudgetBaseUnits,
    perExecutionBaseUnits,
    executionMode: normalizeDcaExecutionMode(config.executionMode),
  };
}
