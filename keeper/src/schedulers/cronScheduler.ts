import { JsonObject, RecipeStatus, RecipeType } from '../db/types';
import { createPublicClient, decodeFunctionData, http } from 'viem';
import { arcTestnet } from 'viem/chains';
import { recipeQueue, RecipeExecutionJobData } from './queueScheduler';
import { publicClient, simulateRecipeStep } from '../simulation/staticSimulationEngine';
import {
  buildAutoCompounderCallData,
  buildRebalancerCallData,
} from '../simulation/recipePayloads';
import { CONTRACT_ADDRESSES, RECIPE_GUARDRAIL_ABI } from '../config/contracts';
import {
  ARC_APP_KIT_DCA_USDC_SPENDER,
  ARC_USDC_ADDRESS,
  DEFAULT_DCA_MAX_SLIPPAGE_BPS,
  parseDcaMaxSlippageBpsWithFallback,
  parseDcaTargetAssetSymbolWithFallback,
} from '../config/dcaRouting';
import { RUNTIME_CONFIG } from '../config/runtime';
import { incrementCounter, readCounter, recordCronCycle } from '../observability/metrics';
import { recipesRepository } from '../db/repositories/recipesRepository';
import {
  estimatedRuns,
  parseDcaConfigStateStrict,
  remainingBudgetBaseUnits,
  toPersistedDcaParameters,
} from '../domain/dcaConfig';
const AUTO_COMPOUNDER_LENDING_BORROWING_ADDRESS = CONTRACT_ADDRESSES.autoCompounderLendingBorrowing;
import { getKeeperAccount, getKeeperWalletClient } from '../index';
import { createDcaSwapRouteClientFromRuntime } from '../integrations/circle/dcaSwapRouteClient';
const MIN_CHECK_INTERVAL_HOURS = 1;
const MAX_CHECK_INTERVAL_HOURS = 24 * 30;
const SIMULATION_RATE_LIMIT_BACKOFF_MS = RUNTIME_CONFIG.schedulerSimulationBackoffMs;
const dedicatedReadClientCache = new Map<string, ReturnType<typeof createPublicClient>>();

// Current deployed LendingBorrowing contract used by AUTO_COMPOUNDER on Arc Testnet.
// Keep this explicit so an old recipe record cannot accidentally point the Keeper
// at the previous LendingBorrowing deployment.

let simulationBackoffUntilMs = 0;
let isPolling = false;
let cronRunning = false;
let lastSimulationBackoffNoticeMs = 0;
let hasLoggedUnauthorizedExecutorHint = false;
const unauthorizedKeeperHintsLogged = new Set<string>();
const protocolCodeCache = new Map<string, { hasCode: boolean; checkedAtMs: number }>();
const protocolNoCodeWarned = new Set<string>();
const PROTOCOL_CODE_CACHE_TTL_MS = 5 * 60 * 1000;
const selectorAllowedCache = new Map<string, { isAllowed: boolean; checkedAtMs: number }>();
const selectorNotAllowedHintsLogged = new Set<string>();
const SELECTOR_ALLOW_CACHE_TTL_MS = 5 * 60 * 1000;
const protocolAllowedCache = new Map<string, { isAllowed: boolean; checkedAtMs: number }>();
const protocolNotAllowedHintsLogged = new Set<string>();
const PROTOCOL_ALLOW_CACHE_TTL_MS = 5 * 60 * 1000;
const appKitBypassHintsLogged = new Set<string>();
const executorNotApprovedHintsLogged = new Set<string>();
const allowanceExceededHintsLogged = new Set<string>();
const allowancePrecheckHintsLogged = new Set<string>();
const unsupportedDcaModeHintsLogged = new Set<string>();
const guardrailOwnerCache = { owner: null as `0x${string}` | null, checkedAtMs: 0 };
const GUARDRAIL_OWNER_CACHE_TTL_MS = 5 * 60 * 1000;
const CLAIMABLE_REWARDS_CACHE_TTL_MS = 30 * 1000;
const claimableRewardsCache = new Map<string, { amount: bigint; checkedAtMs: number }>();
const USDC_ALLOWANCE_CACHE_TTL_MS = 30 * 1000;
const usdcAllowanceCache = new Map<string, { amount: bigint; checkedAtMs: number }>();
const dcaSwapRouteClient = createDcaSwapRouteClientFromRuntime();

const AUTO_COMPOUNDER_REWARDS_ABI = [
  {
    type: 'function',
    name: 'claimableRewards',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
  },
] as const;

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

const ERC20_BALANCE_OF_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
  },
] as const;

const RECIPE_SELECTOR_LABEL: Partial<Record<RecipeType, string>> = {
  AUTO_COMPOUNDER: 'claimRewardsForUser(address)',
  RECURRING_DCA: 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)',
  SMART_YIELD_REBALANCER: 'withdrawForUser(address,uint256)',
};

const DCA_SWAP_SELECTOR = '0x7ebc46f0';
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

interface RecipeParameters {
  checkIntervalHours?: number;
  maxSlippageBps?: number;
  targetAssetSymbol?: string;
}

function recipeLogContext(recipe: { id: string; userAddress: string; recipeType: RecipeType }): string {
  return `[recipeId=${recipe.id} userAddress=${recipe.userAddress} recipeType=${recipe.recipeType}]`;
}

function parseRecipeParameters(parametersJson: unknown): RecipeParameters {
  if (typeof parametersJson !== 'object' || parametersJson === null) {
    return {};
  }

  const raw = parametersJson as Record<string, unknown>;
  const parsed: RecipeParameters = {};

  if (typeof raw.checkIntervalHours === 'number') {
    parsed.checkIntervalHours = raw.checkIntervalHours;
  }

  if (typeof raw.maxSlippageBps === 'number') {
    parsed.maxSlippageBps = raw.maxSlippageBps;
  }

  if (typeof raw.targetAssetSymbol === 'string') {
    parsed.targetAssetSymbol = raw.targetAssetSymbol;
  }

  return parsed;
}

function resolveDcaMaxSlippageBps(recipeParams: RecipeParameters, context: string): number {
  const slippageResult = parseDcaMaxSlippageBpsWithFallback(recipeParams.maxSlippageBps);
  if (slippageResult.usedFallback) {
    console.warn(
      `[Cron Scheduler Warning] Invalid or missing maxSlippageBps ${context}. ` +
      `Using fallback=${DEFAULT_DCA_MAX_SLIPPAGE_BPS} bps for backward compatibility.`
    );
  }
  return slippageResult.maxSlippageBps;
}

function resolveDcaTargetAssetSymbol(
  recipeParams: RecipeParameters,
  context: string
): { targetAssetSymbol: string; usedFallback: boolean } {
  const symbolResult = parseDcaTargetAssetSymbolWithFallback(recipeParams.targetAssetSymbol);
  if (symbolResult.usedFallback) {
    console.warn(
      `[Cron Scheduler Warning] Invalid or missing targetAssetSymbol ${context}. ` +
      `Using fallback=EURC for Arc Testnet compatibility.`
    );
  }
  return {
    targetAssetSymbol: symbolResult.targetAssetSymbol,
    usedFallback: symbolResult.usedFallback,
  };
}

function parseCheckIntervalHours(intervalHours?: number): number {
  const value = intervalHours ?? 24;
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error('checkIntervalHours must be a whole number of hours.');
  }
  if (value < MIN_CHECK_INTERVAL_HOURS || value > MAX_CHECK_INTERVAL_HOURS) {
    throw new Error(
      `checkIntervalHours must be between ${MIN_CHECK_INTERVAL_HOURS} and ${MAX_CHECK_INTERVAL_HOURS}.`
    );
  }
  return value;
}

function toBigIntOrNull(value: unknown): bigint | null {
  if (typeof value === 'bigint') {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0) {
    return BigInt(value);
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }

  return null;
}

function normalizeErrorMessage(errorMessage: string): string {
  return errorMessage.toLowerCase();
}

function getArcRpcUrls(): string[] {
  const urls = [RUNTIME_CONFIG.arcRpcUrl, ...RUNTIME_CONFIG.arcRpcFallbackUrls]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return Array.from(new Set(urls));
}

function getDedicatedReadClient(rpcUrl: string) {
  const cached = dedicatedReadClientCache.get(rpcUrl);
  if (cached) {
    return cached;
  }

  const client = createPublicClient({
    chain: arcTestnet,
    transport: http(rpcUrl, {
      timeout: RUNTIME_CONFIG.arcRpcTimeoutMs,
      retryCount: 0,
    }),
  });

  dedicatedReadClientCache.set(rpcUrl, client);
  return client;
}

function isSimulationRateLimitError(errorMessage: string): boolean {
  const normalized = normalizeErrorMessage(errorMessage);
  const hasHttp429 = /\b429\b/.test(normalized) && normalized.includes('too many requests');
  return (
    normalized.includes('request limit reached') ||
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('-32011') ||
    hasHttp429
  );
}

function isRetryableRpcReadError(errorMessage: string): boolean {
  const normalized = normalizeErrorMessage(errorMessage);
  return (
    isSimulationRateLimitError(errorMessage) ||
    normalized.includes('rpc request failed') ||
    normalized.includes('timeout') ||
    normalized.includes('timed out') ||
    normalized.includes('network error') ||
    normalized.includes('socket hang up') ||
    normalized.includes('econnreset') ||
    normalized.includes('503') ||
    normalized.includes('temporarily unavailable')
  );
}

async function withRpcReadFailover<T>(
  operationLabel: string,
  operation: (client: ReturnType<typeof createPublicClient>) => Promise<T>
): Promise<T> {
  const errors: string[] = [];

  try {
    incrementCounter('rpc.total');
    return await operation(publicClient as ReturnType<typeof createPublicClient>);
  } catch (primaryError: unknown) {
    const message = primaryError instanceof Error ? primaryError.message : String(primaryError);
    errors.push(`[fallback-transport] ${message}`);

    if (!isRetryableRpcReadError(message)) {
      throw primaryError;
    }
  }

  const rpcUrls = getArcRpcUrls();
  for (const rpcUrl of rpcUrls) {
    try {
      incrementCounter('rpc.total');
      return await operation(getDedicatedReadClient(rpcUrl));
    } catch (endpointError: unknown) {
      const message = endpointError instanceof Error ? endpointError.message : String(endpointError);
      errors.push(`[${rpcUrl}] ${message}`);

      if (!isRetryableRpcReadError(message)) {
        throw endpointError;
      }
    }
  }

  const joinedErrors = errors.join(' | ');
  throw new Error(`${operationLabel} failed across all RPC endpoints. ${joinedErrors}`);
}

function isUnauthorizedExecutorError(errorMessage: string): boolean {
  const normalized = normalizeErrorMessage(errorMessage);
  return normalized.includes('unauthorizedexecutor');
}

function isUnauthorizedKeeperError(errorMessage: string): boolean {
  const normalized = normalizeErrorMessage(errorMessage);
  return normalized.includes('unauthorizedkeeper');
}

function isSelectorNotAllowedError(errorMessage: string): boolean {
  const normalized = normalizeErrorMessage(errorMessage);
  return normalized.includes('selectornotallowed');
}

function isExecutorNotApprovedError(errorMessage: string): boolean {
  const normalized = normalizeErrorMessage(errorMessage);
  return normalized.includes('executor not approved');
}

function isAllowanceExceededError(errorMessage: string): boolean {
  const normalized = normalizeErrorMessage(errorMessage);
  return normalized.includes('transfer amount exceeds allowance');
}

function isArcAppKitNoRouteError(errorMessage: string): boolean {
  const normalized = normalizeErrorMessage(errorMessage);
  return (
    normalized.includes('no route available') ||
    normalized.includes('"code":331001')
  );
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
  ].filter((value): value is `0x${string}` => Boolean(value) && value.toLowerCase() !== '0x0000000000000000000000000000000000000000');

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

function extractRevertedContractAddressFromSimulationError(errorMessage: string): `0x${string}` | null {
  const match = errorMessage.match(/contract call:\s*address:\s*(0x[a-fA-F0-9]{40})/i);
  if (!match) {
    return null;
  }

  return match[1].toLowerCase() as `0x${string}`;
}

function resolveDcaAllowanceSpenderAddress(
  callData: `0x${string}`,
  targetProtocol: `0x${string}`,
  routeSpenderAddress: `0x${string}` | null
): `0x${string}` {
  if (routeSpenderAddress) {
    return routeSpenderAddress;
  }

  // App Kit sometimes omits allowanceTarget/spender in response payload.
  // For the known DCA selector shape, try the calldata-derived spender addresses in order.
  if (extractSelectorFromCallData(callData).toLowerCase() === DCA_SWAP_SELECTOR) {
    const decodedSpenders = getDcaDecodedSpenderCandidates(callData);
    if (decodedSpenders.length > 0) {
      return decodedSpenders[0] as `0x${string}`;
    }
  }

  if (targetProtocol && targetProtocol !== ARC_APP_KIT_DCA_USDC_SPENDER) {
    return targetProtocol;
  }

  return ARC_APP_KIT_DCA_USDC_SPENDER;
}

function getDcaAllowanceSpenderCandidates(
  callData: `0x${string}`,
  targetProtocol: `0x${string}`,
  routeSpenderAddress: `0x${string}` | null
): `0x${string}`[] {
  const runtimeSpender = resolveDcaAllowanceSpenderAddress(callData, targetProtocol, routeSpenderAddress);
  const decodedSpenders = getDcaDecodedSpenderCandidates(callData);
  return normalizeDcaSpenderCandidates(
    [runtimeSpender, ...decodedSpenders, targetProtocol, CONTRACT_ADDRESSES.sharedExecutorProxy]
  ).sort() as `0x${string}`[];
}

function maybeLogSelectorNotAllowedHint(
  targetProtocol: `0x${string}`,
  selectorHex: `0x${string}`,
  recipeType: RecipeType,
  guardrailOwnerAddress: `0x${string}`
) {
  const hintKey = `${targetProtocol.toLowerCase()}:${selectorHex.toLowerCase()}`;
  if (selectorNotAllowedHintsLogged.has(hintKey)) {
    return;
  }

  const selectorLabel = RECIPE_SELECTOR_LABEL[recipeType] || selectorHex;
  console.warn(
    `[Cron Scheduler Action Required] Guardrail blocks selector ${selectorHex} (${selectorLabel}) for protocol=${targetProtocol}. ` +
    `From RecipeGuardrail owner wallet ${guardrailOwnerAddress}, call setSelectorWhitelist(${targetProtocol}, ${selectorHex}, true).`
  );
  selectorNotAllowedHintsLogged.add(hintKey);
}

function maybeLogProtocolNotWhitelistedHint(
  targetProtocol: `0x${string}`,
  selectorHex: `0x${string}`,
  guardrailOwnerAddress: `0x${string}`
) {
  const hintKey = targetProtocol.toLowerCase();
  if (protocolNotAllowedHintsLogged.has(hintKey)) {
    return;
  }

  console.warn(
    `[Cron Scheduler Action Required] Guardrail blocks protocol=${targetProtocol} because it is not whitelisted. ` +
    `From RecipeGuardrail owner wallet ${guardrailOwnerAddress}, call setProtocolWhitelist(${targetProtocol}, true). ` +
    `Then ensure selector ${selectorHex} is allowed via setSelectorWhitelist(${targetProtocol}, ${selectorHex}, true).`
  );
  protocolNotAllowedHintsLogged.add(hintKey);
}

function maybeLogAppKitGuardrailBypassHint(
  targetProtocol: `0x${string}`,
  selectorHex: `0x${string}`,
  context: string
) {
  const hintKey = `${targetProtocol.toLowerCase()}:${selectorHex.toLowerCase()}`;
  if (appKitBypassHintsLogged.has(hintKey)) {
    return;
  }

  console.warn(
    `[Cron Scheduler Warning] Guardrail bypass is enabled for App Kit DCA ${context}. ` +
    `Keeper will auto-whitelist targetProtocol=${targetProtocol} selector=${selectorHex} when signer owns RecipeGuardrail.`
  );
  appKitBypassHintsLogged.add(hintKey);
}

async function autoWhitelistGuardrailForAppKitDca(
  targetProtocol: `0x${string}`,
  selectorHex: `0x${string}`,
  guardrailOwnerAddress: `0x${string}`,
  keeperAddress: `0x${string}`,
  context: string
): Promise<boolean> {
  const isKeeperGuardrailOwner = guardrailOwnerAddress.toLowerCase() === keeperAddress.toLowerCase();
  if (!isKeeperGuardrailOwner) {
    console.warn(
      `[Cron Scheduler Action Required] App Kit DCA auto-whitelist is enabled but keeper=${keeperAddress} is not RecipeGuardrail owner=${guardrailOwnerAddress} ${context}. ` +
      `Use guardrail owner key for keeper, or whitelist manually: setProtocolWhitelist(${targetProtocol}, true) and setSelectorWhitelist(${targetProtocol}, ${selectorHex}, true).`
    );
    return false;
  }

  const walletClient = getKeeperWalletClient();
  let changed = false;

  const protocolAllowed = await isProtocolWhitelisted(targetProtocol);
  if (!protocolAllowed) {
    const txHash = await walletClient.writeContract({
      chain: arcTestnet,
      account: getKeeperAccount(),
      address: CONTRACT_ADDRESSES.recipeGuardrail,
      abi: RECIPE_GUARDRAIL_ABI,
      functionName: 'setProtocolWhitelist',
      args: [targetProtocol, true],
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    changed = true;
    console.log(
      `[Cron Scheduler] Auto-whitelisted protocol=${targetProtocol} on RecipeGuardrail txHash=${txHash} ${context}`
    );
  }

  const selectorAllowed = await isSelectorAllowedForProtocol(targetProtocol, selectorHex);
  if (!selectorAllowed) {
    const txHash = await walletClient.writeContract({
      chain: arcTestnet,
      account: getKeeperAccount(),
      address: CONTRACT_ADDRESSES.recipeGuardrail,
      abi: RECIPE_GUARDRAIL_ABI,
      functionName: 'setSelectorWhitelist',
      args: [targetProtocol, selectorHex, true],
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    changed = true;
    console.log(
      `[Cron Scheduler] Auto-whitelisted selector=${selectorHex} for protocol=${targetProtocol} on RecipeGuardrail txHash=${txHash} ${context}`
    );
  }

  if (changed) {
    const protocolCacheKey = targetProtocol.toLowerCase();
    const selectorCacheKey = `${targetProtocol.toLowerCase()}:${selectorHex.toLowerCase()}`;
    protocolAllowedCache.set(protocolCacheKey, { isAllowed: true, checkedAtMs: Date.now() });
    selectorAllowedCache.set(selectorCacheKey, { isAllowed: true, checkedAtMs: Date.now() });
  }

  return true;
}

function maybeLogExecutorNotApprovedHint(targetProtocol: `0x${string}`) {
  const hintKey = targetProtocol.toLowerCase();
  if (executorNotApprovedHintsLogged.has(hintKey)) {
    return;
  }

  console.warn(
    `[Cron Scheduler Action Required] targetProtocol=${targetProtocol} rejected execution because SharedExecutorProxy is not approved. ` +
    `From target protocol owner wallet, call setExecutorApproval(${CONTRACT_ADDRESSES.sharedExecutorProxy}, true).`
  );
  executorNotApprovedHintsLogged.add(hintKey);
}

async function withRpcRateLimitHandling<T>(
  operation: () => Promise<T>
): Promise<T> {
  const now = Date.now();

  if (now < simulationBackoffUntilMs) {
    const remainingSeconds = Math.ceil((simulationBackoffUntilMs - now) / 1000);
    throw new Error(`Arc RPC rate-limit backoff active (${remainingSeconds}s remaining).`);
  }

  try {
    return await operation();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    if (isSimulationRateLimitError(message)) {
      incrementCounter('rpc.rateLimited');
      simulationBackoffUntilMs = Date.now() + SIMULATION_RATE_LIMIT_BACKOFF_MS;
      console.warn(
        `[Cron Scheduler Notice] Arc RPC rate limit detected. ` +
        `Backing off RPC reads/simulations for ${SIMULATION_RATE_LIMIT_BACKOFF_MS / 1000}s.`
      );
    }

    throw error;
  }
}

async function getGuardrailOwnerAddress(): Promise<`0x${string}`> {
  const now = Date.now();
  if (guardrailOwnerCache.owner && now - guardrailOwnerCache.checkedAtMs < GUARDRAIL_OWNER_CACHE_TTL_MS) {
    return guardrailOwnerCache.owner;
  }

  const owner = (await withRpcRateLimitHandling(() =>
    withRpcReadFailover('getGuardrailOwnerAddress', async (client) =>
      client.readContract({
      address: CONTRACT_ADDRESSES.recipeGuardrail,
      abi: [
        {
          type: 'function',
          name: 'owner',
          stateMutability: 'view',
          inputs: [],
          outputs: [{ name: '', type: 'address', internalType: 'address' }],
        },
      ],
      functionName: 'owner',
      args: [],
    })
    )
  )) as `0x${string}`;

  guardrailOwnerCache.owner = owner;
  guardrailOwnerCache.checkedAtMs = now;
  return owner;
}

async function targetProtocolHasCode(targetProtocol: `0x${string}`): Promise<boolean> {
  const now = Date.now();
  const cached = protocolCodeCache.get(targetProtocol);
  if (cached && now - cached.checkedAtMs < PROTOCOL_CODE_CACHE_TTL_MS) {
    return cached.hasCode;
  }

  const bytecode = await withRpcRateLimitHandling(() =>
    withRpcReadFailover('targetProtocolHasCode', async (client) =>
      client.getBytecode({ address: targetProtocol })
    )
  );
  const hasCode = Boolean(bytecode && bytecode !== '0x');
  protocolCodeCache.set(targetProtocol, { hasCode, checkedAtMs: now });
  return hasCode;
}

async function isSelectorAllowedForProtocol(
  targetProtocol: `0x${string}`,
  selectorHex: `0x${string}`
): Promise<boolean> {
  const cacheKey = `${targetProtocol.toLowerCase()}:${selectorHex.toLowerCase()}`;
  const now = Date.now();
  const cached = selectorAllowedCache.get(cacheKey);
  if (cached && now - cached.checkedAtMs < SELECTOR_ALLOW_CACHE_TTL_MS) {
    return cached.isAllowed;
  }

  const isAllowed = (await withRpcRateLimitHandling(() =>
    withRpcReadFailover('isSelectorAllowedForProtocol', async (client) =>
      client.readContract({
      address: CONTRACT_ADDRESSES.recipeGuardrail,
      abi: RECIPE_GUARDRAIL_ABI,
      functionName: 'isSelectorAllowed',
      args: [targetProtocol, selectorHex],
    })
    )
  )) as boolean;

  selectorAllowedCache.set(cacheKey, { isAllowed, checkedAtMs: now });
  return isAllowed;
}

async function isProtocolWhitelisted(targetProtocol: `0x${string}`): Promise<boolean> {
  const cacheKey = targetProtocol.toLowerCase();
  const now = Date.now();
  const cached = protocolAllowedCache.get(cacheKey);
  if (cached && now - cached.checkedAtMs < PROTOCOL_ALLOW_CACHE_TTL_MS) {
    return cached.isAllowed;
  }

  const isAllowed = (await withRpcRateLimitHandling(() =>
    withRpcReadFailover('isProtocolWhitelisted', async (client) =>
      client.readContract({
      address: CONTRACT_ADDRESSES.recipeGuardrail,
      abi: RECIPE_GUARDRAIL_ABI,
      functionName: 'isProtocolWhitelisted',
      args: [targetProtocol],
    })
    )
  )) as boolean;

  protocolAllowedCache.set(cacheKey, { isAllowed, checkedAtMs: now });
  return isAllowed;
}

async function getClaimableRewards(
  targetProtocol: `0x${string}`,
  userAddress: `0x${string}`
): Promise<bigint> {
  const cacheKey = `${targetProtocol.toLowerCase()}:${userAddress.toLowerCase()}`;
  const now = Date.now();
  const cached = claimableRewardsCache.get(cacheKey);
  if (cached && now - cached.checkedAtMs < CLAIMABLE_REWARDS_CACHE_TTL_MS) {
    return cached.amount;
  }

  const amount = (await withRpcRateLimitHandling(() =>
    withRpcReadFailover('getClaimableRewards', async (client) =>
      client.readContract({
      address: targetProtocol,
      abi: AUTO_COMPOUNDER_REWARDS_ABI,
      functionName: 'claimableRewards',
      args: [userAddress],
    })
    )
  )) as bigint;

  claimableRewardsCache.set(cacheKey, { amount, checkedAtMs: now });
  return amount;
}

async function getUsdcAllowance(
  ownerAddress: `0x${string}`,
  spenderAddress: `0x${string}`
): Promise<bigint | null> {
  const cacheKey = `${ownerAddress.toLowerCase()}:${spenderAddress.toLowerCase()}`;
  const now = Date.now();
  const cached = usdcAllowanceCache.get(cacheKey);
  if (cached && now - cached.checkedAtMs < USDC_ALLOWANCE_CACHE_TTL_MS) {
    return cached.amount;
  }

  const rawAllowance = await withRpcRateLimitHandling(() =>
    withRpcReadFailover('getUsdcAllowance', async (client) =>
      client.readContract({
        address: ARC_USDC_ADDRESS,
        abi: ERC20_ALLOWANCE_ABI,
        functionName: 'allowance',
        args: [ownerAddress, spenderAddress],
      })
    )
  );

  const amount = toBigIntOrNull(rawAllowance);
  if (amount === null) {
    console.warn(
      `[Cron Scheduler Warning] Failed to parse USDC allowance owner=${ownerAddress} spender=${spenderAddress}. ` +
      `Proceeding with simulation fallback checks.`
    );
    return null;
  }

  usdcAllowanceCache.set(cacheKey, { amount, checkedAtMs: now });
  return amount;
}

async function getUsdcBalance(ownerAddress: `0x${string}`): Promise<bigint | null> {
  const rawBalance = await withRpcRateLimitHandling(() =>
    withRpcReadFailover('getUsdcBalance', async (client) =>
      client.readContract({
        address: ARC_USDC_ADDRESS,
        abi: ERC20_BALANCE_OF_ABI,
        functionName: 'balanceOf',
        args: [ownerAddress],
      })
    )
  );

  const amount = toBigIntOrNull(rawBalance);
  if (amount === null) {
    console.warn(
      `[Cron Scheduler Warning] Failed to parse USDC balance owner=${ownerAddress}. ` +
      `Proceeding with simulation fallback checks.`
    );
  }

  return amount;
}

/**
 * Periodically queries active recipes in PostgreSQL, evaluates trigger conditions,
 * runs pre-flight eth_call static simulation, and enqueues jobs to BullMQ.
 */
export async function pollAndTriggerActiveRecipes() {
  if (isPolling) {
    console.log('[Cron Scheduler] Previous polling cycle is still running. Skipping this cycle.');
    return;
  }

  isPolling = true;
  const cycleStartedAtMs = Date.now();
  const rpcCountAtStart = readCounter('rpc.total');

  try {
    const nowMs = Date.now();
    if (nowMs < simulationBackoffUntilMs) {
      if (nowMs - lastSimulationBackoffNoticeMs > 10_000) {
        const remainingSeconds = Math.ceil((simulationBackoffUntilMs - nowMs) / 1000);
        console.warn(`[Cron Scheduler Notice] Arc RPC is rate-limited. Backing off simulation calls for ${remainingSeconds}s.`);
        lastSimulationBackoffNoticeMs = nowMs;
      }
      return;
    }

    const activeRecipes = await recipesRepository.findByStatus(RecipeStatus.ACTIVE);

    if (activeRecipes.length === 0) {
      return;
    }

    console.log(`[Cron Scheduler] Polling ${activeRecipes.length} active recipes for execution triggers...`);
    const keeperAccount = getKeeperAccount();

    for (const recipe of activeRecipes) {
      try {
        const context = recipeLogContext({
          id: recipe.id,
          userAddress: recipe.userAddress,
          recipeType: recipe.recipeType,
        });
        const now = new Date();
        const lastExecuted = recipe.lastExecutedAt ? new Date(recipe.lastExecutedAt) : new Date(0);
        const diffHours = (now.getTime() - lastExecuted.getTime()) / (1000 * 60 * 60);
        const recipeParams = parseRecipeParameters(recipe.parametersJson);

        // Default interval threshold: 24 hours between triggers unless overridden
        const intervalHours = parseCheckIntervalHours(recipeParams.checkIntervalHours);
        if (diffHours < intervalHours) {
          console.log(`[Cron Scheduler] Recipe not due yet ${context} elapsedHours=${diffHours.toFixed(2)} intervalHours=${intervalHours}`);
          continue; // Not due yet
        }

        let callData: `0x${string}` = '0x';
        let minAmountOut = '0';
        let routeSpenderAddress: `0x${string}` | null = null;
        let requiredUsdcAllowanceBaseUnits: bigint | null = null;

        // AUTO_COMPOUNDER always targets the current LendingBorrowing deployment.
        // RECURRING_DCA always resolves route + execution target via dcaSwapRouteClient.
        // Other recipe types continue to use their configured targetProtocol.
        let targetProtocol =
          recipe.recipeType === RecipeType.AUTO_COMPOUNDER
            ? AUTO_COMPOUNDER_LENDING_BORROWING_ADDRESS
            : recipe.targetProtocol;

        if (
          recipe.recipeType === RecipeType.AUTO_COMPOUNDER &&
          recipe.targetProtocol?.toLowerCase() !== AUTO_COMPOUNDER_LENDING_BORROWING_ADDRESS.toLowerCase()
        ) {
          console.warn(
            `[Cron Scheduler Notice] AUTO_COMPOUNDER recipe ${context} uses an old targetProtocol=${recipe.targetProtocol}. ` +
            `Using current LendingBorrowing=${AUTO_COMPOUNDER_LENDING_BORROWING_ADDRESS} for this execution.`
          );
        }

        if (recipe.recipeType === RecipeType.AUTO_COMPOUNDER) {
          const claimableRewards = await getClaimableRewards(
            targetProtocol as `0x${string}`,
            recipe.userAddress as `0x${string}`
          );

          console.log(
            `[Cron Scheduler] AUTO_COMPOUNDER claimableRewards ${context}: ${claimableRewards.toString()}`
          );

          if (claimableRewards <= 0n) {
            console.log(
              `[Cron Scheduler] No claimable rewards ${context}. ` +
              `Skipping simulation and enqueue.`
            );
            continue;
          }

          callData = buildAutoCompounderCallData(recipe.userAddress as `0x${string}`);

          // Reward claiming does not spend USDC. Keep delegated spend accounting at zero.
          minAmountOut = '0';
        } else if (recipe.recipeType === RecipeType.RECURRING_DCA) {
          const dcaState = parseDcaConfigStateStrict(recipe.parametersJson);
          const totalEstimatedRuns = estimatedRuns(dcaState);
          const normalizedParameters = toPersistedDcaParameters(
            (typeof recipe.parametersJson === 'object' && recipe.parametersJson !== null
              ? (recipe.parametersJson as JsonObject)
              : {}) as JsonObject,
            dcaState
          );

          if (JSON.stringify(normalizedParameters) !== JSON.stringify(recipe.parametersJson)) {
            await recipesRepository.updateParametersJson(recipe.id, normalizedParameters);
          }

          if (dcaState.status === 'COMPLETED' || dcaState.status === 'CANCELLED') {
            continue;
          }

          const remainingBudget = remainingBudgetBaseUnits(dcaState);
          console.log(
            `[Cron Scheduler] DCA budget snapshot ${context} totalBudget=${dcaState.totalBudgetBaseUnits.toString()} ` +
            `spent=${dcaState.spentAmountBaseUnits.toString()} remaining=${remainingBudget.toString()} estimatedRuns=${totalEstimatedRuns.toString()}`
          );
          if (remainingBudget < dcaState.perExecutionAmountBaseUnits) {
            const completedState = { ...dcaState, status: 'COMPLETED' as const };
            await recipesRepository.updateParametersJson(
              recipe.id,
              toPersistedDcaParameters(normalizedParameters as JsonObject, completedState)
            );
            console.info(
              `[DCA_EVENT] DcaCompleted(user=${recipe.userAddress}, totalBudget=${dcaState.totalBudgetBaseUnits.toString()}, ` +
              `spent=${dcaState.spentAmountBaseUnits.toString()}, remaining=${remainingBudget.toString()}) ${context}`
            );
            continue;
          }

          const dcaExecutionAmount = dcaState.perExecutionAmountBaseUnits;
          const maxSlippageBps = resolveDcaMaxSlippageBps(recipeParams, context);
          const {
            targetAssetSymbol,
            usedFallback: usedTargetAssetFallback,
          } = resolveDcaTargetAssetSymbol(recipeParams, context);

          const hasUnnormalizedTargetAsset = recipeParams.targetAssetSymbol !== targetAssetSymbol;
          if (usedTargetAssetFallback || hasUnnormalizedTargetAsset) {
            const currentParams =
              typeof recipe.parametersJson === 'object' && recipe.parametersJson !== null
                ? (recipe.parametersJson as JsonObject)
                : {};

            const normalizedParams: JsonObject = {
              ...toPersistedDcaParameters(currentParams, dcaState),
              targetAssetSymbol,
            };

            try {
              await recipesRepository.updateParametersJson(recipe.id, normalizedParams);
              recipeParams.targetAssetSymbol = targetAssetSymbol;
              console.log(
                `[Cron Scheduler Notice] Persisted normalized targetAssetSymbol=${targetAssetSymbol} ${context}.`
              );
            } catch (persistError: unknown) {
              const persistErrorMessage = persistError instanceof Error ? persistError.message : String(persistError);
              console.warn(
                `[Cron Scheduler Warning] Failed to persist normalized targetAssetSymbol ${context}: ${persistErrorMessage}`
              );
            }
          }

          if (recipe.swapProvider && recipe.swapProvider !== 'ARC_APP_KIT_SWAP') {
            console.warn(
              `[Cron Scheduler Warning] Unsupported swapProvider=${recipe.swapProvider} ${context}. ` +
              `Proceeding with App Kit route resolution only.`
            );
          }

          try {
            const routePlan = await dcaSwapRouteClient.resolveRoute({
              recipientAddress: recipe.userAddress as `0x${string}`,
              amountInBaseUnits: dcaExecutionAmount,
              maxSlippageBps,
              targetAssetSymbol,
            });

            targetProtocol = routePlan.targetProtocolAddress;
            callData = routePlan.callData;
            routeSpenderAddress = routePlan.spenderAddress ?? null;
          } catch (routeError: unknown) {
            const routeErrorMessage = routeError instanceof Error ? routeError.message : String(routeError);

            if (!isArcAppKitNoRouteError(routeErrorMessage)) {
              throw routeError;
            }

            console.warn(
              `[Cron Scheduler Action Required] App Kit has no swap route ${context}. ` +
              `Reduce dcaAmountUsdc, relax maxSlippageBps, or choose another targetAssetSymbol.`
            );
            continue;
          }

          // Keep spend accounting explicit: this value is consumed by SessionKeyRegistry via SharedExecutorProxy.
          const delegatedUsdcSpendAmount = dcaExecutionAmount;
          minAmountOut = delegatedUsdcSpendAmount.toString();
          requiredUsdcAllowanceBaseUnits = delegatedUsdcSpendAmount;

          if (dcaState.mode === 'PULL') {
            const currentUsdcBalance = await getUsdcBalance(recipe.userAddress as `0x${string}`);
            if (currentUsdcBalance !== null && currentUsdcBalance < dcaExecutionAmount) {
              console.warn(
                `[Cron Scheduler Action Required] DCA pull mode skipped due to insufficient user USDC balance ${context}. ` +
                `currentBalanceBaseUnits=${currentUsdcBalance.toString()} requiredBaseUnits=${dcaExecutionAmount.toString()}.`
              );
              continue;
            }
          }
        } else if (recipe.recipeType === RecipeType.SMART_YIELD_REBALANCER) {
          callData = buildRebalancerCallData(recipe.userAddress as `0x${string}`, 100000000n);
          minAmountOut = '100000000';
        }

        if (!targetProtocol) {
          console.warn(
            `[Cron Scheduler Warning] Missing on-chain targetProtocol ${context}. ` +
            `Recipe execution skipped until a resolvable execution target is available.`
          );
          continue;
        }

        const hasTargetProtocolCode = await targetProtocolHasCode(targetProtocol as `0x${string}`);
        if (!hasTargetProtocolCode) {
          if (!protocolNoCodeWarned.has(targetProtocol)) {
            console.warn(
              `[Cron Scheduler Action Required] targetProtocol=${targetProtocol} has no bytecode on Arc Testnet. ` +
              `Update this recipe to use a deployed protocol contract address.`
            );
            protocolNoCodeWarned.add(targetProtocol);
          }
          continue;
        }

        if (recipe.recipeType === RecipeType.RECURRING_DCA && requiredUsdcAllowanceBaseUnits !== null) {
          const dcaStateForAllowance = parseDcaConfigStateStrict(recipe.parametersJson);
          if (dcaStateForAllowance.mode !== 'PULL') {
            const hintKey = `${recipe.id}:${dcaStateForAllowance.mode}`;
            if (!unsupportedDcaModeHintsLogged.has(hintKey)) {
              console.warn(
                `[Cron Scheduler Action Required] DCA mode=${dcaStateForAllowance.mode} is not supported by current on-chain execution path ${context}. ` +
                `Use mode=PULL and approve allowance for runtime spender, then re-register the recipe.`
              );
              unsupportedDcaModeHintsLogged.add(hintKey);
            }
            continue;
          }
        }

        if (recipe.recipeType === RecipeType.RECURRING_DCA && requiredUsdcAllowanceBaseUnits !== null) {
          const spenderCandidates = getDcaAllowanceSpenderCandidates(
            callData,
            targetProtocol as `0x${string}`,
            routeSpenderAddress
          );
          const selectorHex = extractSelectorFromCallData(callData);
          const runtimeSpender = resolveDcaAllowanceSpenderAddress(
            callData,
            targetProtocol as `0x${string}`,
            routeSpenderAddress
          );
          const decodedSpenders = getDcaDecodedSpenderCandidates(callData);
          console.log(
            `[Cron Scheduler Debug] DCA allowance precheck ${context} selector=${selectorHex} runtimeSpender=${runtimeSpender} requiredBaseUnits=${requiredUsdcAllowanceBaseUnits.toString()} candidateSpenders=${spenderCandidates.join(',')} decodedAbiAddresses=${decodedSpenders.join(',') || 'none'}`
          );
          const insufficient: Array<{ spender: `0x${string}`; allowance: bigint }> = [];

          for (const spender of spenderCandidates) {
            const currentAllowance = await getUsdcAllowance(recipe.userAddress as `0x${string}`, spender);
            console.log(
              `[Cron Scheduler Debug] DCA allowance detail ${context} spender=${spender} currentAllowanceBaseUnits=${currentAllowance?.toString() ?? 'null'} requiredBaseUnits=${requiredUsdcAllowanceBaseUnits.toString()}`
            );
            if (currentAllowance !== null && currentAllowance < requiredUsdcAllowanceBaseUnits) {
              insufficient.push({ spender, allowance: currentAllowance });
            }
          }

          if (insufficient.length > 0) {
            const configuredDcaAmount = requiredUsdcAllowanceBaseUnits.toString();
            const hintKey = `${recipe.id}:${spenderCandidates.join(',')}:${configuredDcaAmount}`;

            if (!allowancePrecheckHintsLogged.has(hintKey)) {
              const details = insufficient
                .map((entry) => `spender=${entry.spender} currentAllowanceBaseUnits=${entry.allowance.toString()}`)
                .join('; ');
              console.warn(
                `[Cron Scheduler Action Required] DCA allowance is lower than configured spend ${context}. ` +
                `Current configured perExecutionAmountBaseUnits=${configuredDcaAmount}. ` +
                `${details} requiredBaseUnits=${requiredUsdcAllowanceBaseUnits.toString()}. ` +
                `Increase user USDC allowance for each spender above, or re-register this recipe with a lower perExecutionAmountUsdc in parametersJson.`
              );
              allowancePrecheckHintsLogged.add(hintKey);
            }

            continue;
          }
        }

        const selectorHex = extractSelectorFromCallData(callData);
        const guardrailOwnerAddress = await getGuardrailOwnerAddress();

        const isAppKitDcaRecipe =
          recipe.recipeType === RecipeType.RECURRING_DCA && recipe.swapProvider === 'ARC_APP_KIT_SWAP';
        const shouldBypassGuardrail =
          isAppKitDcaRecipe && RUNTIME_CONFIG.allowAppKitDcaGuardrailBypass;

        if (shouldBypassGuardrail) {
          maybeLogAppKitGuardrailBypassHint(targetProtocol as `0x${string}`, selectorHex, context);

          const autoWhitelistApplied = await autoWhitelistGuardrailForAppKitDca(
            targetProtocol as `0x${string}`,
            selectorHex,
            guardrailOwnerAddress,
            keeperAccount.address,
            context
          );
          if (!autoWhitelistApplied) {
            continue;
          }
        }

        const isProtocolAllowed = await isProtocolWhitelisted(targetProtocol as `0x${string}`);
        if (!isProtocolAllowed) {
          maybeLogProtocolNotWhitelistedHint(
            targetProtocol as `0x${string}`,
            selectorHex,
            guardrailOwnerAddress
          );
          continue;
        }

        const isSelectorAllowed = await isSelectorAllowedForProtocol(targetProtocol as `0x${string}`, selectorHex);
        if (!isSelectorAllowed) {
          maybeLogSelectorNotAllowedHint(targetProtocol as `0x${string}`, selectorHex, recipe.recipeType, guardrailOwnerAddress);
          continue;
        }

        // Pre-flight static simulation via eth_call
        const simResult = await simulateRecipeStep(
          {
            userAddress: recipe.userAddress as `0x${string}`,
            executorProxyAddress: CONTRACT_ADDRESSES.sharedExecutorProxy as `0x${string}`,
            targetProtocolAddress: targetProtocol as `0x${string}`,
            callData,
            minAmountOut: BigInt(minAmountOut),
            keeperAddress: keeperAccount.address,
          },
          {
            includeGasEstimate: RUNTIME_CONFIG.simulationEstimateGas,
          }
        );

        if (!simResult.success) {
          const simulationError = simResult.errorMessage || 'Unknown simulation error';

          if (isUnauthorizedExecutorError(simulationError) && !hasLoggedUnauthorizedExecutorHint) {
            console.warn(
              `[Cron Scheduler Action Required] SharedExecutorProxy is not authorized in SessionKeyRegistry. ` +
              `From the SessionKeyRegistry owner wallet, call setExecutorAuthorization(${CONTRACT_ADDRESSES.sharedExecutorProxy}, true).`
            );
            hasLoggedUnauthorizedExecutorHint = true;
          }

          if (isUnauthorizedKeeperError(simulationError)) {
            const keeperHintKey = `${recipe.userAddress.toLowerCase()}:${keeperAccount.address.toLowerCase()}`;
            if (!unauthorizedKeeperHintsLogged.has(keeperHintKey)) {
              console.warn(
                `[Cron Scheduler Action Required] Keeper session key is not valid for this user. ` +
                `From user ${recipe.userAddress}, call registerSessionKey(${keeperAccount.address}, validUntilUnixTimestamp, maxUsdcSpendLimitBaseUnits) on SessionKeyRegistry ${CONTRACT_ADDRESSES.sessionKeyRegistry}.`
              );
              unauthorizedKeeperHintsLogged.add(keeperHintKey);
            }
          }

          if (isSelectorNotAllowedError(simulationError)) {
            const guardrailOwnerAddress = await getGuardrailOwnerAddress();
            maybeLogSelectorNotAllowedHint(targetProtocol as `0x${string}`, selectorHex, recipe.recipeType, guardrailOwnerAddress);
          }

          if (isExecutorNotApprovedError(simulationError)) {
            maybeLogExecutorNotApprovedHint(targetProtocol as `0x${string}`);
          }

          if (recipe.recipeType === RecipeType.RECURRING_DCA && isAllowanceExceededError(simulationError)) {
            const dcaStateForAllowance = parseDcaConfigStateStrict(recipe.parametersJson);
            const configuredDcaAmount = dcaStateForAllowance.perExecutionAmountBaseUnits.toString();
            const runtimeSpender = resolveDcaAllowanceSpenderAddress(
              callData,
              targetProtocol as `0x${string}`,
              routeSpenderAddress
            ).toLowerCase();
            const spenderCandidates = getDcaAllowanceSpenderCandidates(
              callData,
              targetProtocol as `0x${string}`,
              routeSpenderAddress
            );
            const revertedContractAddress = extractRevertedContractAddressFromSimulationError(simulationError);
            const simulationAllowanceCandidates = normalizeDcaSpenderCandidates(
              revertedContractAddress
                ? [...spenderCandidates, revertedContractAddress]
                : spenderCandidates
            );
            const allowanceDetails: Array<{ spender: `0x${string}`; allowance: bigint | null }> = [];
            for (const spender of simulationAllowanceCandidates) {
              allowanceDetails.push({
                spender,
                allowance: await getUsdcAllowance(recipe.userAddress as `0x${string}`, spender),
              });
            }

            const requiredAmount = BigInt(configuredDcaAmount);
            const decodedSpenders = getDcaDecodedSpenderCandidates(callData);
            console.warn(
              `[Cron Scheduler Debug] DCA simulation allowance failure ${context} selector=${selectorHex} requiredBaseUnits=${requiredAmount.toString()} runtimeSpender=${runtimeSpender} revertedContractAddress=${revertedContractAddress || 'none'} decodedAbiAddresses=${decodedSpenders.join(',') || 'none'}`
            );
            const insufficient = allowanceDetails.filter(
              (entry) => entry.allowance !== null && entry.allowance < requiredAmount
            );
            const hintKey = `${recipe.id}:${runtimeSpender}:${configuredDcaAmount}`;
            if (!allowanceExceededHintsLogged.has(hintKey)) {
              if (insufficient.length > 0) {
                const details = insufficient
                  .map((entry) => `spender=${entry.spender} currentAllowanceBaseUnits=${entry.allowance?.toString() || 'unknown'}`)
                  .join('; ');
                console.warn(
                  `[Cron Scheduler Action Required] DCA allowance is lower than configured spend ${context}. ` +
                  `Current configured perExecutionAmountBaseUnits=${configuredDcaAmount}. ` +
                  `${details}. Increase user USDC allowance for each spender above, or re-register this recipe with a lower perExecutionAmountUsdc in parametersJson.`
                );
              } else {
                const details = allowanceDetails
                  .map((entry) => `spender=${entry.spender} currentAllowanceBaseUnits=${entry.allowance?.toString() || 'unknown'}`)
                  .join('; ');
                console.warn(
                  `[Cron Scheduler Notice] DCA simulation reverted with allowance error ${context}, ` +
                  `but known spender allowances look sufficient for configured perExecutionAmountBaseUnits=${configuredDcaAmount}. ` +
                  `${details}. Verify SessionKeyRegistry spend limits and downstream route contract pull-path expectations.`
                );
              }
              allowanceExceededHintsLogged.add(hintKey);
            }
          }

          // Rewards can disappear between the pre-check and the simulation.
          if (normalizeErrorMessage(simulationError).includes('no rewards')) {
            console.log(
              `[Cron Scheduler] Rewards became unavailable between pre-check and simulation ${context}. ` +
              `Skipping enqueue.`
            );
            continue;
          }

          if (isSimulationRateLimitError(simulationError)) {
            incrementCounter('simulation.rateLimitFailures');
            simulationBackoffUntilMs = Date.now() + SIMULATION_RATE_LIMIT_BACKOFF_MS;
            console.warn(
              `[Cron Scheduler Notice] Arc RPC rate limit detected. Pausing new simulation calls for ` +
              `${SIMULATION_RATE_LIMIT_BACKOFF_MS / 1000}s.`
            );
          }

          console.warn(`[Cron Scheduler Notice] Simulation failed ${context}: ${simResult.errorMessage}. Skipping enqueue.`);
          continue;
        }

        // Enqueue job to recipeQueue
        const jobData: RecipeExecutionJobData = {
          recipeId: recipe.id,
          recipeType: recipe.recipeType,
          userAddress: recipe.userAddress as `0x${string}`,
          executorProxyAddress: CONTRACT_ADDRESSES.sharedExecutorProxy as `0x${string}`,
          targetProtocolAddress: targetProtocol as `0x${string}`,
          callData,
          minAmountOut,
          keeperAddress: keeperAccount.address,
          queueEnqueuedAtMs: Date.now(),
          preflightSimulationPassed: simResult.success,
          preflightEstimatedGasUsdc: simResult.estimatedGasUsdc?.toString(),
          ...(recipe.recipeType === RecipeType.RECURRING_DCA
            ? {
                dcaMode: parseDcaConfigStateStrict(recipe.parametersJson).mode,
                dcaExecutionAmountBaseUnits: minAmountOut,
              }
            : {}),
        };

        const executionBucket = Math.floor(now.getTime() / (intervalHours * 60 * 60 * 1000));
        const jobId = `execute-${recipe.id}-${executionBucket}`;
        await recipeQueue.add(jobId, jobData, { jobId });
        incrementCounter('queue.enqueued');
        console.log(`[Cron Scheduler] Enqueued recipe ${context} jobId=${jobId}`);
      } catch (recipeErr: unknown) {
        const recipeErrorMessage = recipeErr instanceof Error ? recipeErr.message : 'Unknown recipe scheduling error';
        console.warn(`[Cron Scheduler Notice] Skipping recipe ${recipeLogContext(recipe)}: ${recipeErrorMessage}`);
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown scheduler error';
    console.warn(`[Cron Scheduler Error] ${message}`);
  } finally {
    const cycleDurationMs = Date.now() - cycleStartedAtMs;
    const cycleRpcCalls = Math.max(0, readCounter('rpc.total') - rpcCountAtStart);
    recordCronCycle(cycleDurationMs, cycleRpcCalls);
    isPolling = false;
  }
}

let cronTimer: NodeJS.Timeout | null = null;

export function startCronScheduler(intervalMs: number = 30_000) {
  if (cronRunning) {
    console.warn('[Cron Scheduler] Scheduler is already running.');
    return;
  }

  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error('Cron scheduler intervalMs must be a positive number.');
  }

  cronRunning = true;

  console.log(
    `[Cron Scheduler] Active recipe poll scheduler started ` +
    `(Interval: ${intervalMs / 1000}s)`
  );

  const scheduleNext = async () => {
    if (!cronRunning) {
      return;
    }

    try {
      await pollAndTriggerActiveRecipes();
    } finally {
      if (cronRunning) {
        cronTimer = setTimeout(scheduleNext, intervalMs);
      }
    }
  };

  void scheduleNext();
}

export function stopCronScheduler() {
  cronRunning = false;

  if (cronTimer) {
    clearTimeout(cronTimer);
    cronTimer = null;
  }
}

export function __resetCronSchedulerStateForTests() {
  simulationBackoffUntilMs = 0;
  isPolling = false;
  cronRunning = false;
  lastSimulationBackoffNoticeMs = 0;
  hasLoggedUnauthorizedExecutorHint = false;

  unauthorizedKeeperHintsLogged.clear();
  protocolCodeCache.clear();
  protocolNoCodeWarned.clear();
  selectorAllowedCache.clear();
  selectorNotAllowedHintsLogged.clear();
  protocolAllowedCache.clear();
  protocolNotAllowedHintsLogged.clear();
  executorNotApprovedHintsLogged.clear();
  allowanceExceededHintsLogged.clear();
  allowancePrecheckHintsLogged.clear();
  unsupportedDcaModeHintsLogged.clear();
  claimableRewardsCache.clear();
  usdcAllowanceCache.clear();
  dedicatedReadClientCache.clear();

  guardrailOwnerCache.owner = null;
  guardrailOwnerCache.checkedAtMs = 0;
}