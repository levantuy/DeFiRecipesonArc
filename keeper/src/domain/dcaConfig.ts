import { JsonObject } from '../db/types';

export type DcaExecutionMode = 'PREFUND' | 'PULL';
export type DcaLifecycleStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';

const USDC_BASE = 1_000_000n;
const USDC_AMOUNT_REGEX = /^\d+(\.\d{1,6})?$/;

export interface DcaConfigState {
  totalBudgetBaseUnits: bigint;
  perExecutionAmountBaseUnits: bigint;
  spentAmountBaseUnits: bigint;
  executedCount: number;
  mode: DcaExecutionMode;
  status: DcaLifecycleStatus;
  totalBudgetUsdc: string;
  perExecutionAmountUsdc: string;
}

function toObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function parseNonNegativeBigInt(value: unknown, fieldName: string): bigint {
  if (typeof value === 'bigint') {
    if (value < 0n) {
      throw new Error(`${fieldName} must be non-negative.`);
    }
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0) {
    return BigInt(value);
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }

  throw new Error(`${fieldName} must be a non-negative integer base-unit value.`);
}

function parsePositiveUsdcToBaseUnits(value: unknown, fieldName: string): { amountBaseUnits: bigint; normalizedUsdc: string } {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string.`);
  }

  const normalized = value.trim();
  if (!USDC_AMOUNT_REGEX.test(normalized)) {
    throw new Error(`${fieldName} must be numeric with up to 6 decimals.`);
  }

  const [wholePartRaw, fractionalPartRaw = ''] = normalized.split('.');
  const wholePart = BigInt(wholePartRaw);
  const fractionalPart = BigInt((fractionalPartRaw + '000000').slice(0, 6));
  const amountBaseUnits = wholePart * USDC_BASE + fractionalPart;

  if (amountBaseUnits <= 0n) {
    throw new Error(`${fieldName} must be greater than 0.`);
  }

  return {
    amountBaseUnits,
    normalizedUsdc: normalized,
  };
}

function normalizeExecutionMode(value: unknown): DcaExecutionMode {
  if (value === 'PREFUND') {
    return 'PREFUND';
  }
  return 'PULL';
}

function normalizeStatus(value: unknown): DcaLifecycleStatus {
  if (value === 'PAUSED' || value === 'COMPLETED' || value === 'CANCELLED') {
    return value;
  }
  return 'ACTIVE';
}

export function parseDcaConfigStateStrict(parametersJson: unknown): DcaConfigState {
  const raw = toObject(parametersJson);

  const totalBudgetUsdcCandidate = raw.totalBudgetUsdc;
  const perExecutionUsdcCandidate = raw.perExecutionAmountUsdc ?? raw.dcaAmountUsdc;

  if (totalBudgetUsdcCandidate === undefined || perExecutionUsdcCandidate === undefined) {
    throw new Error('DCA configuration requires totalBudgetUsdc and perExecutionAmountUsdc.');
  }

  const totalBudget = parsePositiveUsdcToBaseUnits(totalBudgetUsdcCandidate, 'totalBudgetUsdc');
  const perExecution = parsePositiveUsdcToBaseUnits(perExecutionUsdcCandidate, 'perExecutionAmountUsdc');

  let totalBudgetBaseUnits = totalBudget.amountBaseUnits;
  let perExecutionAmountBaseUnits = perExecution.amountBaseUnits;

  if (raw.totalBudgetBaseUnits !== undefined) {
    totalBudgetBaseUnits = parseNonNegativeBigInt(raw.totalBudgetBaseUnits, 'totalBudgetBaseUnits');
  }

  if (raw.perExecutionAmountBaseUnits !== undefined) {
    perExecutionAmountBaseUnits = parseNonNegativeBigInt(
      raw.perExecutionAmountBaseUnits,
      'perExecutionAmountBaseUnits'
    );
  }

  if (perExecutionAmountBaseUnits <= 0n) {
    throw new Error('perExecutionAmountBaseUnits must be greater than 0.');
  }

  if (totalBudgetBaseUnits <= 0n) {
    throw new Error('totalBudgetBaseUnits must be greater than 0.');
  }

  if (perExecutionAmountBaseUnits > totalBudgetBaseUnits) {
    throw new Error('perExecutionAmount cannot exceed totalBudget.');
  }

  const spentAmountBaseUnits =
    raw.spentAmountBaseUnits !== undefined
      ? parseNonNegativeBigInt(raw.spentAmountBaseUnits, 'spentAmountBaseUnits')
      : 0n;

  if (spentAmountBaseUnits > totalBudgetBaseUnits) {
    throw new Error('spentAmountBaseUnits cannot exceed totalBudgetBaseUnits.');
  }

  const executedCount =
    typeof raw.executedCount === 'number' && Number.isFinite(raw.executedCount) && raw.executedCount >= 0
      ? Math.floor(raw.executedCount)
      : 0;

  return {
    totalBudgetBaseUnits,
    perExecutionAmountBaseUnits,
    spentAmountBaseUnits,
    executedCount,
    mode: normalizeExecutionMode(raw.mode),
    status: normalizeStatus(raw.status),
    totalBudgetUsdc: totalBudget.normalizedUsdc,
    perExecutionAmountUsdc: perExecution.normalizedUsdc,
  };
}

export function toPersistedDcaParameters(
  currentParametersJson: JsonObject,
  state: DcaConfigState
): JsonObject {
  return {
    ...currentParametersJson,
    totalBudgetUsdc: state.totalBudgetUsdc,
    totalBudgetBaseUnits: state.totalBudgetBaseUnits.toString(),
    perExecutionAmountUsdc: state.perExecutionAmountUsdc,
    perExecutionAmountBaseUnits: state.perExecutionAmountBaseUnits.toString(),
    spentAmountBaseUnits: state.spentAmountBaseUnits.toString(),
    executedCount: state.executedCount,
    mode: state.mode,
    status: state.status,
    // Backward-compatible aliases retained for legacy code paths.
    dcaAmountUsdc: state.perExecutionAmountUsdc,
    dcaAmountUsdcBaseUnits: state.perExecutionAmountBaseUnits.toString(),
  };
}

export function remainingBudgetBaseUnits(state: DcaConfigState): bigint {
  return state.totalBudgetBaseUnits - state.spentAmountBaseUnits;
}

export function applyDcaExecution(state: DcaConfigState, executionAmountBaseUnits: bigint): DcaConfigState {
  if (executionAmountBaseUnits <= 0n) {
    throw new Error('executionAmountBaseUnits must be greater than 0.');
  }

  const remainingBefore = remainingBudgetBaseUnits(state);
  if (executionAmountBaseUnits > remainingBefore) {
    throw new Error('Execution amount exceeds remaining DCA budget.');
  }

  const spentAmountBaseUnits = state.spentAmountBaseUnits + executionAmountBaseUnits;
  const remainingAfter = state.totalBudgetBaseUnits - spentAmountBaseUnits;

  return {
    ...state,
    spentAmountBaseUnits,
    executedCount: state.executedCount + 1,
    status: remainingAfter === 0n ? 'COMPLETED' : state.status,
  };
}

export function estimatedRuns(state: DcaConfigState): bigint {
  return state.perExecutionAmountBaseUnits === 0n
    ? 0n
    : state.totalBudgetBaseUnits / state.perExecutionAmountBaseUnits;
}
