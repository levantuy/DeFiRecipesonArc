import { recipesRepository } from '../db/repositories/recipesRepository';
import { executionLogsRepository } from '../db/repositories/executionLogsRepository';
import { JsonObject, RecipeStatus, RecipeType, SwapProvider } from '../db/types';
import { decodeFunctionData, formatUnits, type Address, type Hash } from 'viem';
import { publicClient } from '../simulation/staticSimulationEngine';
import {
  ARC_APP_KIT_DCA_USDC_SPENDER,
  ARC_SWAP_ADAPTER_EXECUTE_SELECTOR,
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

const DCA_SWAP_SELECTOR = '0x7ebc46f0';
const DCA_ALWAYS_STRICT_SPENDERS = new Set<string>([
  '0x00000000000000000000000000000000000000c0',
]);
const DCA_SWAP_ABI = [
  {
    type: 'function',
    name: 'swapExactTokensForTokens',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
] as const;
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
      throw new Error('RECURRING_DCA does not accept targetProtocol. Route resolution is managed by ARC_LIFI_SWAP.');
    }

    if (swapProvider !== null && swapProvider !== 'ARC_LIFI_SWAP' && swapProvider !== 'ARC_APP_KIT_SWAP') {
      throw new Error('RECURRING_DCA requires swapProvider=ARC_LIFI_SWAP (or ARC_APP_KIT_SWAP for legacy fallback).');
    }

    let dcaParameters = { ...(parametersJson as Record<string, unknown>) };

    if (dcaParameters.maxSlippageBps !== undefined) {
      parseDcaMaxSlippageBpsStrict(dcaParameters.maxSlippageBps);
    }

    const normalizedDcaState = parseDcaConfigStateStrict(dcaParameters);
    if (normalizedDcaState.mode !== 'PULL') {
      throw new Error(
        'RECURRING_DCA currently supports mode=PULL only. PREFUND execution path is not available yet.'
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
      swapProvider: swapProvider ?? 'ARC_LIFI_SWAP',
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
} {
  if (!isRecord(rawQuery)) {
    return { limit: 25 };
  }

  const query = rawQuery as ListExecutionLogsPayload;
  const parsedLimit = Number(query.limit ?? 25);
  const limit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(100, Math.floor(parsedLimit)))
    : 25;

  const userAddress = query.userAddress !== undefined
    ? normalizeAddress(query.userAddress, 'userAddress')
    : undefined;

  return {
    userAddress,
    limit,
  };
}

function toRelativeTime(timestamp: Date): string {
  const diffMs = Date.now() - timestamp.getTime();
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

async function resolveGasUsedUsdc(log: {
  gasUsedUsdc: string | null;
  txHash: string | null;
}): Promise<string | null> {
  if (!log.gasUsedUsdc) {
    return null;
  }

  const reportedGas = Number(log.gasUsedUsdc);
  if (Number.isFinite(reportedGas) && reportedGas < 1_000) {
    return log.gasUsedUsdc;
  }

  if (!log.txHash || !/^0x[a-fA-F0-9]{64}$/.test(log.txHash)) {
    return null;
  }

  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: log.txHash as Hash });
    return formatUnits(receipt.gasUsed * receipt.effectiveGasPrice, 18);
  } catch {
    return null;
  }
}

export async function listExecutionLogs(
  rawQuery: unknown
): Promise<Record<string, unknown>> {
  const payload = parseListExecutionLogsPayload(rawQuery);

  const logs = await executionLogsRepository.listRecentLogs({
    userAddress: payload.userAddress,
    limit: payload.limit,
  });

  const formattedLogs = await Promise.all(logs.map(async (log) => {
    const eventTimestamp = log.executedAt || log.simulatedAt;
    const gasUsedUsdc = await resolveGasUsedUsdc(log);
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
  }));

  return {
    success: true,
    logs: formattedLogs,
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

function extractSelectorFromCallData(callData: `0x${string}`): `0x${string}` {
  if (callData.length < 10) {
    return '0x';
  }
  return callData.slice(0, 10) as `0x${string}`;
}

function extractAddressWordFromCalldata(callData: `0x${string}`, wordIndex: number): `0x${string}` | null {
  const data = callData.slice(2);
  const start = 8 + wordIndex * 64;
  const end = start + 64;
  if (data.length < end) {
    return null;
  }

  const word = data.slice(start, end);
  const addressHex = `0x${word.slice(24)}`;
  if (!/^0x[a-fA-F0-9]{40}$/.test(addressHex)) {
    return null;
  }

  return addressHex.toLowerCase() as `0x${string}`;
}

function getDcaDecodedSpenderCandidates(callData: `0x${string}`): `0x${string}`[] {
  const fallbackCandidates = [
    extractAddressWordFromCalldata(callData, 1),
    extractAddressWordFromCalldata(callData, 3),
  ].filter(
    (value): value is `0x${string}` =>
      value !== null && value.toLowerCase() !== '0x0000000000000000000000000000000000000000'
  );

  try {
    const decoded = decodeFunctionData({
      abi: DCA_SWAP_ABI,
      data: callData,
    });

    if (decoded.functionName !== 'swapExactTokensForTokens') {
      return Array.from(new Set(fallbackCandidates.map((candidate) => candidate.toLowerCase()))) as `0x${string}`[];
    }

    const [, , path, to] = decoded.args as [bigint, bigint, readonly `0x${string}`[], `0x${string}`, bigint];
    const abiCandidates = [to, ...(Array.isArray(path) ? path : [])].filter(
      (value): value is `0x${string}` => Boolean(value) && /^0x[a-fA-F0-9]{40}$/.test(value) && value.toLowerCase() !== '0x0000000000000000000000000000000000000000'
    );

    const merged = Array.from(new Set([...abiCandidates, ...fallbackCandidates]));
    return merged.map((candidate) => candidate.toLowerCase()) as `0x${string}`[];
  } catch {
    return Array.from(new Set(fallbackCandidates.map((candidate) => candidate.toLowerCase()))) as `0x${string}`[];
  }
}

function normalizeDcaSpenderCandidates(candidates: `0x${string}`[]): `0x${string}`[] {
  return Array.from(
    new Set(
      candidates
        .filter((candidate) => candidate.toLowerCase() !== '0x0000000000000000000000000000000000000000')
        .map((candidate) => candidate.toLowerCase())
    )
  ) as `0x${string}`[];
}

function resolveDcaAllowanceSpenderAddress(
  callData: `0x${string}`,
  targetProtocol: `0x${string}`,
  routeSpenderAddress: `0x${string}` | undefined
): `0x${string}` {
  if (routeSpenderAddress) {
    return routeSpenderAddress;
  }

  if (extractSelectorFromCallData(callData).toLowerCase() === DCA_SWAP_SELECTOR) {
    const decodedSpenders = getDcaDecodedSpenderCandidates(callData);
    if (decodedSpenders.length > 0) {
      return decodedSpenders[0] as `0x${string}`;
    }
  }

  if (targetProtocol !== ARC_APP_KIT_DCA_USDC_SPENDER) {
    return targetProtocol;
  }

  return ARC_APP_KIT_DCA_USDC_SPENDER;
}

function getDcaAllowanceSpenderCandidates(
  callData: `0x${string}`,
  targetProtocol: `0x${string}`,
  routeSpenderAddress: `0x${string}` | undefined
): `0x${string}`[] {
  const runtimeSpender = resolveDcaAllowanceSpenderAddress(callData, targetProtocol, routeSpenderAddress);
  const decodedSpenders = getDcaDecodedSpenderCandidates(callData);
  return normalizeDcaSpenderCandidates(
    [runtimeSpender, ...decodedSpenders, targetProtocol, CONTRACT_ADDRESSES.sharedExecutorProxy]
  ).sort() as `0x${string}`[];
}

function getDcaAlwaysStrictDecodedSpenders(
  callData: `0x${string}`,
  userAddress: `0x${string}`
): `0x${string}`[] {
  const normalizedUserAddress = userAddress.toLowerCase();
  return getDcaDecodedSpenderCandidates(callData).filter((candidate) => {
    const normalized = candidate.toLowerCase();
    return normalized !== normalizedUserAddress && DCA_ALWAYS_STRICT_SPENDERS.has(normalized);
  });
}

function getDcaStrictRequiredSpenders(
  callData: `0x${string}`,
  targetProtocol: `0x${string}`,
  routeSpenderAddress: `0x${string}` | undefined,
  userAddress: `0x${string}`
): `0x${string}`[] {
  const selector = extractSelectorFromCallData(callData).toLowerCase();
  const strictDecodedSpenders = getDcaAlwaysStrictDecodedSpenders(callData, userAddress);
  if (selector === DCA_SWAP_SELECTOR || selector === ARC_SWAP_ADAPTER_EXECUTE_SELECTOR) {
    // Both shapes are executed through SharedExecutorProxy, which pulls USDC from the user first.
    return normalizeDcaSpenderCandidates([
      CONTRACT_ADDRESSES.sharedExecutorProxy as `0x${string}`,
      ...strictDecodedSpenders,
    ]);
  }

  const runtimeSpender = resolveDcaAllowanceSpenderAddress(callData, targetProtocol, routeSpenderAddress);
  return normalizeDcaSpenderCandidates([runtimeSpender, ...strictDecodedSpenders]);
}

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

export async function precheckDcaAllowance(
  rawBody: unknown
): Promise<Record<string, unknown>> {
  const payload = parseDcaAllowancePrecheckPayload(rawBody);

  const routePlan = await dcaSwapRouteClient.resolveRoute({
    recipientAddress: payload.userAddress,
    amountInBaseUnits: payload.perExecutionBaseUnits,
    maxSlippageBps: payload.maxSlippageBps,
    targetAssetSymbol: payload.targetAssetSymbol,
  });

  const runtimeSpender = resolveDcaAllowanceSpenderAddress(
    routePlan.callData,
    routePlan.targetProtocolAddress,
    routePlan.spenderAddress
  );

  const requiredSpenders = getDcaAllowanceSpenderCandidates(
    routePlan.callData,
    routePlan.targetProtocolAddress,
    routePlan.spenderAddress
  );
  const strictRequiredSpenders = getDcaStrictRequiredSpenders(
    routePlan.callData,
    routePlan.targetProtocolAddress,
    routePlan.spenderAddress,
    payload.userAddress
  );

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
  const decodedSpenders = getDcaDecodedSpenderCandidates(routePlan.callData);
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
      targetProtocolAddress: routePlan.targetProtocolAddress,
      callDataSelector: extractSelectorFromCallData(routePlan.callData),
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
      checkedAt: new Date().toISOString(),
    },
  };
}