import { formatUnits, parseUnits } from 'viem';

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

export const USDC_DECIMALS = 6;

function parseBaseUnitValue(value: string | bigint | number): bigint | null {
  if (typeof value === 'bigint') {
    return value >= 0n ? value : null;
  }

  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  }

  const normalized = value.trim();
  return /^\d+$/.test(normalized) ? BigInt(normalized) : null;
}

export function formatUsdcBaseUnits(
  value: string | bigint | number,
  options: { locale?: string; maximumFractionDigits?: number } = {}
): string {
  const baseUnits = parseBaseUnitValue(value);
  if (baseUnits === null) {
    return '0';
  }

  const formatted = formatUnits(baseUnits, USDC_DECIMALS);
  const [wholePart, fractionalPart = ''] = formatted.split('.');
  const maximumFractionDigits = options.maximumFractionDigits ?? USDC_DECIMALS;
  const trimmedFraction = fractionalPart.slice(0, maximumFractionDigits).replace(/0+$/, '');
  return formatUsdcDecimal(trimmedFraction ? `${wholePart}.${trimmedFraction}` : wholePart, options);
}

export function formatUsdcDecimal(
  value: string,
  options: { locale?: string; maximumFractionDigits?: number } = {}
): string {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return '0';
  }

  const [wholePart, fractionalPart = ''] = normalized.split('.');
  const maximumFractionDigits = options.maximumFractionDigits ?? USDC_DECIMALS;
  const trimmedFraction = fractionalPart.slice(0, maximumFractionDigits).replace(/0+$/, '');
  const groupedWholePart = new Intl.NumberFormat(options.locale, {
    useGrouping: true,
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(BigInt(wholePart));
  const decimalSeparator = new Intl.NumberFormat(options.locale)
    .formatToParts(1.1)
    .find((part) => part.type === 'decimal')?.value || '.';

  return trimmedFraction ? `${groupedWholePart}${decimalSeparator}${trimmedFraction}` : groupedWholePart;
}

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
