import { recipesRepository } from '../db/repositories/recipesRepository';
import { executionLogsRepository } from '../db/repositories/executionLogsRepository';
import { JsonObject, RecipeStatus, RecipeType, SwapProvider } from '../db/types';
import { formatUnits, type Address, type Hash } from 'viem';
import { publicClient } from '../simulation/staticSimulationEngine';
import {
  ARC_USDC_ADDRESS,
  DEFAULT_DCA_TARGET_ASSET_SYMBOL,
  parseDcaMaxSlippageBpsStrict,
  parseDcaMaxSlippageBpsWithFallback,
  parseDcaTargetAssetSymbolStrict,
  parseDcaTargetAssetSymbolWithFallback,
} from '../config/dcaRouting';
import { CONTRACT_ADDRESSES, SESSION_KEY_REGISTRY_ABI } from '../config/contracts';
import { getKeeperPrivateKey } from '../config/runtime';
import { privateKeyToAccount } from 'viem/accounts';
import {
  parseDcaConfigStateStrict,
  toPersistedDcaParameters,
} from '../domain/dcaConfig';
import {
  DCA_SWAP_SELECTOR,
  DCA_ALWAYS_STRICT_SPENDERS,
  DCA_SWAP_ABI,
  extractSelectorFromCallData,
  extractAddressWordFromCalldata,
  getDcaDecodedSpenderCandidates,
  normalizeDcaSpenderCandidates,
  resolveDcaAllowanceSpenderAddress,
  getDcaAllowanceSpenderCandidates,
  getDcaAlwaysStrictDecodedSpenders,
  getDcaStrictRequiredSpenders,
} from '../domain/dcaCalldata';
import { createDcaSwapRouteClientFromRuntime } from '../integrations/circle/dcaSwapRouteClient';

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const RECIPE_TYPE_SET = new Set(Object.values(RecipeType));
const RECIPE_STATUS_SET = new Set(Object.values(RecipeStatus));
const SWAP_PROVIDER_SET = new Set(Object.values(SwapProvider));

interface RegisterRecipePayload {
  userAddress?: unknown;
  recipeType?: unknown;
  targetProtocol?: unknown;
  swapProvider?: unknown;
  parametersJson?: unknown;
}

interface UpdateRecipeStatusPayload {
  userAddress?: unknown;
  recipeType?: unknown;
  status?: unknown;
  txHash?: unknown;
}

interface ListExecutionLogsPayload {
  userAddress?: unknown;
  limit?: unknown;
  offset?: unknown;
  page?: unknown;
  status?: unknown;
}

interface ListRecipesPayload {
  userAddress?: unknown;
  limit?: unknown;
}

interface DcaAllowancePrecheckPayload {
  userAddress?: unknown;
  totalBudgetUsdc?: unknown;
  perExecutionAmountUsdc?: unknown;
  maxSlippageBps?: unknown;
  targetAssetSymbol?: unknown;
}

const ERC20_ALLOWANCE_ABI = [
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address', internalType: 'address' },
      { name: 'spender', type: 'address', internalType: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
  },
] as const;

// DCA_SWAP_SELECTOR, DCA_ALWAYS_STRICT_SPENDERS, DCA_SWAP_ABI and DCA calldata
// utility functions are imported from '../domain/dcaCalldata' (shared module).
const dcaSwapRouteClient = createDcaSwapRouteClientFromRuntime();

function recipeLogContext(params: { userAddress: string; recipeType: RecipeType; recipeId?: string }): string {
  const recipeIdPart = params.recipeId ? ` recipeId=${params.recipeId}` : '';
  return `[userAddress=${params.userAddress} recipeType=${params.recipeType}${recipeIdPart}]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeAddress(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !ADDRESS_REGEX.test(value)) {
    throw new Error(`${fieldName} must be a valid 20-byte hex address.`);
  }
  return value.toLowerCase();
}

function parseRecipeType(value: unknown): RecipeType {
  if (typeof value !== 'string' || !RECIPE_TYPE_SET.has(value as RecipeType)) {
    throw new Error(`recipeType must be one of: ${Object.values(RecipeType).join(', ')}`);
  }
  return value as RecipeType;
}

function parseRecipeStatus(value: unknown): RecipeStatus {
  if (typeof value !== 'string' || !RECIPE_STATUS_SET.has(value as RecipeStatus)) {
    throw new Error(`status must be one of: ${Object.values(RecipeStatus).join(', ')}`);
  }
  return value as RecipeStatus;
}

function parseSwapProvider(value: unknown): SwapProvider {
  if (typeof value !== 'string' || !SWAP_PROVIDER_SET.has(value as SwapProvider)) {
    throw new Error(`swapProvider must be one of: ${Array.from(SWAP_PROVIDER_SET).join(', ')}`);
  }
  return value as SwapProvider;
}

// Cumulative session spend quota bounds (USDC display units), shared by every recipe under the
// same userAddress + keeperSessionKeyAddress pair. Not a per-transaction cap.
const MIN_SESSION_SPEND_LIMIT_USDC = '1';
const MAX_SESSION_SPEND_LIMIT_USDC = '1000000';
const DEFAULT_SESSION_SPEND_LIMIT_USDC = '500';
const MIN_CHECK_INTERVAL_HOURS = 1;
const MAX_CHECK_INTERVAL_HOURS = 720;
const DEFAULT_CHECK_INTERVAL_HOURS: Record<string, number> = {
  RECURRING_DCA: 24,
  AUTO_COMPOUNDER: 168,
};

function usdcDecimalStringToBaseUnits(normalized: string): bigint {
  const [wholePartRaw, fractionalPartRaw = ''] = normalized.split('.');
  const wholePart = BigInt(wholePartRaw);
  const fractionalPart = BigInt((fractionalPartRaw + '000000').slice(0, 6));
  return wholePart * 1_000_000n + fractionalPart;
}

function parseSessionSpendLimitUsdc(value: unknown): { display: string; baseUnits: bigint } {
  if (typeof value !== 'string') {
    throw new Error('sessionSpendLimitUsdc must be a string.');
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error('sessionSpendLimitUsdc is required.');
  }

  if (!/^\d+(\.\d{1,6})?$/.test(normalized)) {
    throw new Error('sessionSpendLimitUsdc must be numeric with up to 6 decimals.');
  }

  const baseUnits = usdcDecimalStringToBaseUnits(normalized);
  if (baseUnits <= 0n) {
    throw new Error('sessionSpendLimitUsdc must be greater than 0.');
  }

  const minBaseUnits = usdcDecimalStringToBaseUnits(MIN_SESSION_SPEND_LIMIT_USDC);
  const maxBaseUnits = usdcDecimalStringToBaseUnits(MAX_SESSION_SPEND_LIMIT_USDC);
  if (baseUnits < minBaseUnits || baseUnits > maxBaseUnits) {
    throw new Error(
      `sessionSpendLimitUsdc must be between ${MIN_SESSION_SPEND_LIMIT_USDC} and ${MAX_SESSION_SPEND_LIMIT_USDC} USDC.`
    );
  }

  return { display: normalized, baseUnits };
}

function parseCheckIntervalHours(rawValue: unknown, recipeType: RecipeType): number {
  const value = rawValue === undefined
    ? DEFAULT_CHECK_INTERVAL_HOURS[recipeType] ?? 24
    : typeof rawValue === 'string'
      ? Number(rawValue.trim())
      : rawValue;

  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error('checkIntervalHours must be a whole number of hours.');
  }
  if (value < MIN_CHECK_INTERVAL_HOURS || value > MAX_CHECK_INTERVAL_HOURS) {
    throw new Error(`checkIntervalHours must be between ${MIN_CHECK_INTERVAL_HOURS} and ${MAX_CHECK_INTERVAL_HOURS}.`);
  }
  return value;
}

function parseRegisterPayload(rawBody: unknown): {
  userAddress: string;
  recipeType: RecipeType;
  targetProtocol: string | null;
  swapProvider: SwapProvider | null;
  parametersJson: JsonObject;
} {
  if (!isRecord(rawBody)) {
    throw new Error('Request body must be a JSON object.');
  }

  const body = rawBody as RegisterRecipePayload;
  const userAddress = normalizeAddress(body.userAddress, 'userAddress');
  const recipeType = parseRecipeType(body.recipeType);
  const swapProvider = body.swapProvider === undefined
    ? null
    : parseSwapProvider(body.swapProvider);
  const targetProtocol = body.targetProtocol === undefined
    ? null
    : normalizeAddress(body.targetProtocol, 'targetProtocol');

  let parametersJson: JsonObject = {};
  if (body.parametersJson !== undefined) {
    if (!isRecord(body.parametersJson)) {
      throw new Error('parametersJson must be a JSON object when provided.');
    }
    parametersJson = body.parametersJson;
  }

  // Cumulative session spend quota shared by every recipe under this userAddress + keeper session
  // key pair. Canonical field is sessionSpendLimitUsdc; maxUsdcSpendLimit is kept as a legacy alias.
  const requestedSessionSpendLimit =
    (parametersJson as Record<string, unknown>).sessionSpendLimitUsdc ??
    (parametersJson as Record<string, unknown>).maxUsdcSpendLimit ??
    DEFAULT_SESSION_SPEND_LIMIT_USDC;
  const { display: sessionSpendLimitUsdc, baseUnits: sessionSpendLimitBaseUnits } =
    parseSessionSpendLimitUsdc(requestedSessionSpendLimit);
  parametersJson = {
    ...parametersJson,
    checkIntervalHours: parseCheckIntervalHours(
      (parametersJson as Record<string, unknown>).checkIntervalHours,
      recipeType
    ),
    sessionSpendLimitUsdc,
    sessionSpendLimitBaseUnits: sessionSpendLimitBaseUnits.toString(),
    maxUsdcSpendLimit: sessionSpendLimitUsdc,
  };

  if (recipeType === RecipeType.RECURRING_DCA) {
    if (targetProtocol) {
      throw new Error('RECURRING_DCA does not accept targetProtocol. Route resolution is managed by the selected swapProvider.');
    }

    // All SwapProvider values are valid for RECURRING_DCA; validation is handled by parseSwapProvider above.

    let dcaParameters = { ...(parametersJson as Record<string, unknown>) };

    if (dcaParameters.maxSlippageBps !== undefined) {
      parseDcaMaxSlippageBpsStrict(dcaParameters.maxSlippageBps);
    }

    const normalizedDcaState = parseDcaConfigStateStrict(dcaParameters);
    if (normalizedDcaState.mode !== 'PULL') {
      throw new Error(
        'RECURRING_DCA currently supports execution mode PULL_PER_RUN only.'
      );
    }
    dcaParameters = {
      ...dcaParameters,
      ...toPersistedDcaParameters(dcaParameters as JsonObject, normalizedDcaState),
    };

    if (dcaParameters.targetAssetSymbol === undefined) {
      dcaParameters.targetAssetSymbol = DEFAULT_DCA_TARGET_ASSET_SYMBOL;
    } else {
      dcaParameters.targetAssetSymbol = parseDcaTargetAssetSymbolStrict(dcaParameters.targetAssetSymbol);
    }

    parametersJson = dcaParameters;

    return {
      userAddress,
      recipeType,
      targetProtocol: null,
      swapProvider: swapProvider ?? 'CURVE_DIRECT',
      parametersJson,
    };
  }

  if (!targetProtocol && !swapProvider) {
    throw new Error('Either targetProtocol or swapProvider is required.');
  }

  return {
    userAddress,
    recipeType,
    targetProtocol,
    swapProvider,
    parametersJson,
  };
}

async function assertTargetProtocolHasCode(targetProtocol: string): Promise<void> {
  const bytecode = await publicClient.getBytecode({
    address: targetProtocol as Address,
  });

  if (!bytecode || bytecode === '0x') {
    throw new Error(
      `targetProtocol ${targetProtocol} has no deployed contract bytecode on Arc Testnet. ` +
      `Use a deployed protocol contract address.`
    );
  }
}

function parseStatusPayload(rawBody: unknown): {
  userAddress: string;
  recipeType: RecipeType;
  status: RecipeStatus;
  txHash?: `0x${string}`;
} {
  if (!isRecord(rawBody)) {
    throw new Error('Request body must be a JSON object.');
  }

  const body = rawBody as UpdateRecipeStatusPayload;
  let txHash: `0x${string}` | undefined;
  if (body.txHash !== undefined) {
    if (typeof body.txHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(body.txHash)) {
      throw new Error('txHash must be a valid 32-byte transaction hash when provided.');
    }
    txHash = body.txHash as `0x${string}`;
  }

  return {
    userAddress: normalizeAddress(body.userAddress, 'userAddress'),
    recipeType: parseRecipeType(body.recipeType),
    status: parseRecipeStatus(body.status),
    txHash,
  };
}

export async function registerOrActivateRecipe(
  rawBody: unknown
): Promise<Record<string, unknown>> {
  const payload = parseRegisterPayload(rawBody);
  const context = recipeLogContext({
    userAddress: payload.userAddress,
    recipeType: payload.recipeType,
  });

  console.log(`[Keeper API] Register/Activate requested ${context}`);

  if (payload.targetProtocol) {
    await assertTargetProtocolHasCode(payload.targetProtocol);
  }

  const existingRecipe = await recipesRepository.findMatchingForRegistration({
    userAddress: payload.userAddress,
    recipeType: payload.recipeType,
    targetProtocol: payload.targetProtocol,
    swapProvider: payload.swapProvider,
  });

  if (existingRecipe) {
    const updated = await recipesRepository.updateForActivation(existingRecipe.id, {
      status: RecipeStatus.ACTIVE,
      targetProtocol: payload.targetProtocol,
      swapProvider: payload.swapProvider,
      parametersJson: payload.parametersJson,
    });

    console.log(
      `[Keeper API] Register/Activate updated existing recipe ${recipeLogContext({
        userAddress: updated.userAddress,
        recipeType: updated.recipeType,
        recipeId: updated.id,
      })}`
    );

    return {
      success: true,
      operation: 'updated',
      recipe: {
        id: updated.id,
        userAddress: updated.userAddress,
        recipeType: updated.recipeType,
        status: updated.status,
        targetProtocol: updated.targetProtocol,
        swapProvider: updated.swapProvider ?? null,
      },
    };
  }

  const created = await recipesRepository.createWithUserConnectOrCreate({
    userAddress: payload.userAddress,
    recipeType: payload.recipeType,
    targetProtocol: payload.targetProtocol,
    swapProvider: payload.swapProvider,
    parametersJson: payload.parametersJson,
  });

  console.log(
    `[Keeper API] Register/Activate created recipe ${recipeLogContext({
      userAddress: created.userAddress,
      recipeType: created.recipeType,
      recipeId: created.id,
    })}`
  );

  if (payload.recipeType === RecipeType.RECURRING_DCA) {
    const dcaState = parseDcaConfigStateStrict(payload.parametersJson);
    console.info(
      `[DCA_EVENT] DcaActivated(user=${payload.userAddress}, totalBudget=${dcaState.totalBudgetBaseUnits.toString()}, ` +
      `perExecutionAmount=${dcaState.perExecutionAmountBaseUnits.toString()}, mode=${dcaState.mode})`
    );
  }

  return {
    success: true,
    operation: 'created',
    recipe: {
      id: created.id,
      userAddress: created.userAddress,
      recipeType: created.recipeType,
      status: created.status,
      targetProtocol: created.targetProtocol,
      swapProvider: created.swapProvider ?? null,
    },
  };
}

export async function updateRecipeStatus(
  rawBody: unknown
): Promise<Record<string, unknown>> {
  const payload = parseStatusPayload(rawBody);
  const context = recipeLogContext({
    userAddress: payload.userAddress,
    recipeType: payload.recipeType,
  });

  console.log(`[Keeper API] Status update requested ${context} targetStatus=${payload.status}`);

  const existingRecipe = await recipesRepository.findLatestByUserAndType(payload.userAddress, payload.recipeType);

  if (!existingRecipe) {
    console.warn(`[Keeper API] Status update skipped - recipe not found ${context}`);
    throw new Error('No matching recipe found to update status.');
  }

  const updated = await recipesRepository.updateStatus(existingRecipe.id, payload.status);

  if (payload.txHash) {
    await recipesRepository.updateParametersJson(existingRecipe.id, {
      ...updated.parametersJson,
      delegationTxHash: payload.txHash,
      delegationUpdatedAt: new Date().toISOString(),
    });
  }

  console.log(
    `[Keeper API] Status updated ${recipeLogContext({
      userAddress: updated.userAddress,
      recipeType: updated.recipeType,
      recipeId: updated.id,
    })} newStatus=${updated.status}`
  );

  return {
    success: true,
    recipe: {
      id: updated.id,
      userAddress: updated.userAddress,
      recipeType: updated.recipeType,
      status: updated.status,
      targetProtocol: updated.targetProtocol,
      swapProvider: updated.swapProvider ?? null,
    },
  };
}

function parseListExecutionLogsPayload(rawQuery: unknown): {
  userAddress?: string;
  limit: number;
  offset: number;
  page: number;
  status?: string;
} {
  if (!isRecord(rawQuery)) {
    return { limit: 10, offset: 0, page: 1 };
  }

  const query = rawQuery as ListExecutionLogsPayload;
  const parsedLimit = Number(query.limit ?? 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(50, Math.floor(parsedLimit)))
    : 10;

  const parsedOffset = Number(query.offset ?? 0);
  const offset = Number.isFinite(parsedOffset) ? Math.max(0, Math.floor(parsedOffset)) : 0;

  const parsedPage = Number(query.page ?? 1);
  const page = Number.isFinite(parsedPage) ? Math.max(1, Math.floor(parsedPage)) : 1;

  const userAddress = query.userAddress !== undefined
    ? normalizeAddress(query.userAddress, 'userAddress')
    : undefined;

  const status = typeof query.status === 'string' && query.status
    ? query.status.toUpperCase()
    : undefined;

  const resolvedOffset = offset > 0 || query.offset === undefined
    ? offset
    : (page - 1) * limit;

  return {
    userAddress,
    limit,
    offset: resolvedOffset,
    page,
    status,
  };
}

function toRelativeTime(timestamp: Date): string {
  const diffMs = Date.now() - timestamp.getTime();
  // Guard against clock skew: negative diff (future timestamp) is treated as "just now".
  if (diffMs < 60_000) {
    return 'just now';
  }

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) {
    return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// Maximum on-chain receipt fetches per listExecutionLogs call.
// Each fetch is an RPC round-trip; cap prevents N+1 RPC bursts on large pages.
const MAX_RECEIPT_FETCHES_PER_PAGE = 5;

type GasLogEntry = { gasUsedUsdc: string | null; txHash: string | null };

/**
 * Resolve stored gas values for a batch of logs.
 * - Entries with a stored value that is already sane (< 1 000 USDC) are returned directly.
 * - Entries that appear inflated are re-fetched from on-chain receipts, capped at
 *   MAX_RECEIPT_FETCHES_PER_PAGE to avoid N+1 RPC bursts when paging over many logs.
 */
async function resolveGasUsedUsdcBatch(logs: GasLogEntry[]): Promise<(string | null)[]> {
  // Pass 1 — cheap synchronous resolution: detect which entries still need RPC.
  const results: (string | null | undefined)[] = logs.map((log) => {
    if (!log.gasUsedUsdc) return null;
    const reported = Number(log.gasUsedUsdc);
    if (Number.isFinite(reported) && reported < 1_000) return log.gasUsedUsdc;
    return undefined; // sentinel: needs RPC receipt
  });

  // Pass 2 — capped RPC fetches for inflated values.
  let fetchBudget = MAX_RECEIPT_FETCHES_PER_PAGE;
  const fetches: Promise<void>[] = [];

  for (let i = 0; i < logs.length; i++) {
    if (results[i] !== undefined) continue;
    const log = logs[i];
    if (!log.txHash || !/^0x[a-fA-F0-9]{64}$/.test(log.txHash)) {
      results[i] = null;
      continue;
    }
    if (fetchBudget <= 0) {
      results[i] = null;
      continue;
    }
    fetchBudget -= 1;
    const idx = i;
    const hash = log.txHash as Hash;
    fetches.push(
      publicClient
        .getTransactionReceipt({ hash })
        .then((receipt) => {
          results[idx] = formatUnits(receipt.gasUsed * receipt.effectiveGasPrice, 18);
        })
        .catch(() => {
          results[idx] = null;
        })
    );
  }

  await Promise.all(fetches);
  return results.map((v) => (v === undefined ? null : v));
}

export async function listExecutionLogs(
  rawQuery: unknown
): Promise<Record<string, unknown>> {
  const payload = parseListExecutionLogsPayload(rawQuery);

  const total = await executionLogsRepository.countLogs({
    userAddress: payload.userAddress,
    status: payload.status as 'ALL' | undefined,
  });

  const logs = await executionLogsRepository.listRecentLogs({
    userAddress: payload.userAddress,
    status: payload.status as 'ALL' | undefined,
    limit: payload.limit,
    offset: payload.offset,
  });

  const gasValues = await resolveGasUsedUsdcBatch(logs);
  const formattedLogs = logs.map((log, i) => {
    const eventTimestamp = log.executedAt || log.simulatedAt;
    const gasUsedUsdc = gasValues[i];
    return {
      id: log.id,
      recipeId: log.activeRecipeId,
      recipeType: log.recipeType,
      userAddress: log.recipeUserAddress,
      txHash: log.txHash,
      timestamp: toRelativeTime(eventTimestamp),
      timestampIso: eventTimestamp.toISOString(),
      status: log.status,
      gasUsedUsdc: gasUsedUsdc ? `${gasUsedUsdc} USDC` : null,
      errorMessage: log.errorMessage,
    };
  });

  const page = Math.max(1, Math.floor(payload.offset / payload.limit) + 1);
  const hasMore = payload.offset + formattedLogs.length < total;

  return {
    success: true,
    logs: formattedLogs,
    total,
    page,
    pageSize: payload.limit,
    hasMore,
  };
}

function parseListRecipesPayload(rawQuery: unknown): {
  userAddress?: string;
  limit: number;
} {
  if (!isRecord(rawQuery)) {
    return { limit: 100 };
  }

  const query = rawQuery as ListRecipesPayload;
  const parsedLimit = Number(query.limit ?? 100);
  const limit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(200, Math.floor(parsedLimit)))
    : 100;

  const userAddress = query.userAddress !== undefined
    ? normalizeAddress(query.userAddress, 'userAddress')
    : undefined;

  return {
    userAddress,
    limit,
  };
}

export async function listActiveRecipes(rawQuery: unknown): Promise<Record<string, unknown>> {
  const payload = parseListRecipesPayload(rawQuery);
  const recipes = await recipesRepository.listLatestByUserAndType({
    userAddress: payload.userAddress,
    limit: payload.limit,
  });

  return {
    success: true,
    recipes: recipes.map((recipe) => ({
      delegationTxHash:
        typeof recipe.parametersJson.delegationTxHash === 'string'
          ? recipe.parametersJson.delegationTxHash
          : null,
      delegationValidUntil:
        typeof recipe.parametersJson.delegationValidUntil === 'string'
          ? recipe.parametersJson.delegationValidUntil
          : null,
      id: recipe.id,
      userAddress: recipe.userAddress,
      recipeType: recipe.recipeType,
      status: recipe.status,
      targetProtocol: recipe.targetProtocol,
      swapProvider: recipe.swapProvider,
      parametersJson: recipe.parametersJson,
      createdAt: recipe.createdAt.toISOString(),
      updatedAt: recipe.updatedAt.toISOString(),
      lastExecutedAt: recipe.lastExecutedAt ? recipe.lastExecutedAt.toISOString() : null,
    })),
  };
}

interface SessionSpendQuotaPayload {
  userAddress?: unknown;
  sessionKeyAddress?: unknown;
}

// On-chain SessionKeyRegistry permission is the source of truth for maxUsdcSpendLimit and
// currentUsdcSpent; this is a read-only projection for UI display, never used for accounting.
export async function getSessionSpendQuota(rawQuery: unknown): Promise<Record<string, unknown>> {
  if (!isRecord(rawQuery)) {
    throw new Error('Request query must be an object.');
  }

  const query = rawQuery as SessionSpendQuotaPayload;
  const userAddress = normalizeAddress(query.userAddress, 'userAddress');
  const sessionKeyAddress =
    query.sessionKeyAddress !== undefined
      ? normalizeAddress(query.sessionKeyAddress, 'sessionKeyAddress')
      : privateKeyToAccount(getKeeperPrivateKey()).address.toLowerCase();

  const permission = (await publicClient.readContract({
    address: CONTRACT_ADDRESSES.sessionKeyRegistry,
    abi: SESSION_KEY_REGISTRY_ABI,
    functionName: 'getSessionPermission',
    args: [userAddress as Address, sessionKeyAddress as Address],
  })) as {
    validUntil: bigint;
    maxUsdcSpendLimit: bigint;
    currentUsdcSpent: bigint;
    revoked: boolean;
    exists: boolean;
  };

  const maxUsdcSpendLimit = BigInt(permission.maxUsdcSpendLimit);
  const currentUsdcSpent = BigInt(permission.currentUsdcSpent);
  const remainingUsdcSpendLimit =
    maxUsdcSpendLimit === 0n ? 0n : maxUsdcSpendLimit > currentUsdcSpent ? maxUsdcSpendLimit - currentUsdcSpent : 0n;

  return {
    success: true,
    quota: {
      exists: permission.exists,
      revoked: permission.revoked,
      maxUsdcSpendLimit: formatUnits(maxUsdcSpendLimit, 6),
      currentUsdcSpent: formatUnits(currentUsdcSpent, 6),
      remainingUsdcSpendLimit: formatUnits(remainingUsdcSpendLimit, 6),
      validUntil: permission.exists
        ? new Date(Number(permission.validUntil) * 1000).toISOString()
        : null,
    },
  };
}

function parseUsdcAmountToBaseUnits(value: unknown, fieldName: string): bigint {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string.`);
  }

  const normalized = value.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(normalized)) {
    throw new Error(`${fieldName} must be numeric with up to 6 decimals.`);
  }

  const [wholePartRaw, fractionalPartRaw = ''] = normalized.split('.');
  const wholePart = BigInt(wholePartRaw);
  const fractionalPart = BigInt((fractionalPartRaw + '000000').slice(0, 6));
  const amountBaseUnits = wholePart * 1_000_000n + fractionalPart;

  if (amountBaseUnits <= 0n) {
    throw new Error(`${fieldName} must be greater than 0.`);
  }

  return amountBaseUnits;
}

// extractSelectorFromCallData, extractAddressWordFromCalldata, getDcaDecodedSpenderCandidates,
// normalizeDcaSpenderCandidates, resolveDcaAllowanceSpenderAddress, getDcaAllowanceSpenderCandidates,
// getDcaAlwaysStrictDecodedSpenders, and getDcaStrictRequiredSpenders are all imported
// from '../domain/dcaCalldata' (shared module — see that file for implementations).

function parseDcaAllowancePrecheckPayload(rawBody: unknown): {
  userAddress: `0x${string}`;
  totalBudgetBaseUnits: bigint;
  perExecutionBaseUnits: bigint;
  maxSlippageBps: number;
  targetAssetSymbol: string;
} {
  if (!isRecord(rawBody)) {
    throw new Error('Request body must be a JSON object.');
  }

  const body = rawBody as DcaAllowancePrecheckPayload;
  const userAddress = normalizeAddress(body.userAddress, 'userAddress') as `0x${string}`;
  const totalBudgetBaseUnits = parseUsdcAmountToBaseUnits(body.totalBudgetUsdc, 'totalBudgetUsdc');
  const perExecutionBaseUnits = parseUsdcAmountToBaseUnits(body.perExecutionAmountUsdc, 'perExecutionAmountUsdc');

  if (perExecutionBaseUnits > totalBudgetBaseUnits) {
    throw new Error('perExecutionAmountUsdc must be less than or equal to totalBudgetUsdc.');
  }

  const slippageResult = parseDcaMaxSlippageBpsWithFallback(body.maxSlippageBps);
  const symbolResult = parseDcaTargetAssetSymbolWithFallback(body.targetAssetSymbol);

  return {
    userAddress,
    totalBudgetBaseUnits,
    perExecutionBaseUnits,
    maxSlippageBps: slippageResult.maxSlippageBps,
    targetAssetSymbol: symbolResult.targetAssetSymbol,
  };
}

// Known-stable spender addresses for CIRCLE_DIRECT / ARC_LIFI_SWAP on Arc Testnet.
// Used as fallback when the swap route service is temporarily unavailable (e.g. Circle 331001).
// arc-studio-allow-onchain-literal
const ARC_SWAP_ADAPTER_ADDRESS_FALLBACK = '0xbbd70b01a1cabc96d5b7b129ae1aaabdf50dd40b' as `0x${string}`; // arc-studio-allow-onchain-literal

export async function precheckDcaAllowance(
  rawBody: unknown
): Promise<Record<string, unknown>> {
  const payload = parseDcaAllowancePrecheckPayload(rawBody);

  let routePlan: Awaited<ReturnType<typeof dcaSwapRouteClient.resolveRoute>> | null = null;
  let routeUnavailable = false;

  try {
    routePlan = await dcaSwapRouteClient.resolveRoute({
      recipientAddress: payload.userAddress,
      // fromAddress must be SharedExecutorProxy so Circle binds tokens[0].beneficiary to it.
      sourceAddress: CONTRACT_ADDRESSES.sharedExecutorProxy as `0x${string}`,
      amountInBaseUnits: payload.perExecutionBaseUnits,
      maxSlippageBps: payload.maxSlippageBps,
      targetAssetSymbol: payload.targetAssetSymbol,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('no route') || msg.includes('331001') || msg.includes('intermittent')) {
      routeUnavailable = true;
      console.warn(`[Keeper API] precheckDcaAllowance: swap route temporarily unavailable (${msg.slice(0, 80)}). Using static spender fallback.`);
    } else {
      throw err;
    }
  }

  let runtimeSpender: `0x${string}`;
  let requiredSpenders: `0x${string}`[];
  let strictRequiredSpenders: `0x${string}`[];
  let callDataSelector: string | null;
  let decodedSpenders: `0x${string}`[];
  let targetProtocolAddress: `0x${string}`;

  if (routeUnavailable || !routePlan) {
    // Fallback: use known static spenders — real on-chain allowance check still runs.
    runtimeSpender = CONTRACT_ADDRESSES.sharedExecutorProxy as `0x${string}`;
    requiredSpenders = [
      CONTRACT_ADDRESSES.sharedExecutorProxy as `0x${string}`,
      ARC_SWAP_ADAPTER_ADDRESS_FALLBACK,
    ];
    strictRequiredSpenders = [CONTRACT_ADDRESSES.sharedExecutorProxy as `0x${string}`];
    callDataSelector = null;
    decodedSpenders = [];
    targetProtocolAddress = ARC_SWAP_ADAPTER_ADDRESS_FALLBACK;
  } else {
    runtimeSpender = resolveDcaAllowanceSpenderAddress(
      routePlan.callData,
      routePlan.targetProtocolAddress,
      routePlan.spenderAddress
    );
    requiredSpenders = getDcaAllowanceSpenderCandidates(
      routePlan.callData,
      routePlan.targetProtocolAddress,
      routePlan.spenderAddress
    );
    strictRequiredSpenders = getDcaStrictRequiredSpenders(
      routePlan.callData,
      routePlan.targetProtocolAddress,
      routePlan.spenderAddress,
      payload.userAddress
    );
    callDataSelector = extractSelectorFromCallData(routePlan.callData);
    decodedSpenders = getDcaDecodedSpenderCandidates(routePlan.callData);
    targetProtocolAddress = routePlan.targetProtocolAddress;
  }

  const allowanceBySpender: Record<string, string> = {};
  for (const spender of requiredSpenders) {
    const allowanceRaw = await publicClient.readContract({
      address: ARC_USDC_ADDRESS,
      abi: ERC20_ALLOWANCE_ABI,
      functionName: 'allowance',
      args: [payload.userAddress, spender],
    });
    allowanceBySpender[spender.toLowerCase()] = BigInt(allowanceRaw).toString();
  }

  const currentAllowanceBaseUnits = allowanceBySpender[runtimeSpender.toLowerCase()] || '0';
  const requiredForSchedulerBaseUnits = payload.perExecutionBaseUnits.toString();
  const requiredForActivationBaseUnits = payload.totalBudgetBaseUnits.toString();
  const isEnoughForScheduler = strictRequiredSpenders.every((spender) => {
    const allowance = BigInt(allowanceBySpender[spender.toLowerCase()] || '0');
    return allowance >= payload.perExecutionBaseUnits;
  });
  const isEnoughForActivation = strictRequiredSpenders.every((spender) => {
    const allowance = BigInt(allowanceBySpender[spender.toLowerCase()] || '0');
    return allowance >= payload.totalBudgetBaseUnits;
  });

  return {
    success: true,
    allowance: {
      userAddress: payload.userAddress,
      runtimeSpender,
      decodedAbiAddresses: decodedSpenders,
      targetProtocolAddress,
      callDataSelector,
      targetAssetSymbol: payload.targetAssetSymbol,
      maxSlippageBps: payload.maxSlippageBps,
      currentAllowanceBaseUnits,
      requiredForSchedulerBaseUnits,
      requiredForActivationBaseUnits,
      requiredSpenders: strictRequiredSpenders,
      advisorySpenders: requiredSpenders,
      allowanceBySpender,
      isEnoughForScheduler,
      isEnoughForActivation,
      routeAvailable: !routeUnavailable,
      checkedAt: new Date().toISOString(),
    },
  };
}