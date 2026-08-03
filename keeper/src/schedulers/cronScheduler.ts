import { RecipeStatus, RecipeType } from '../db/types';
import { createPublicClient, http } from 'viem';
import { arcTestnet } from 'viem/chains';
import { recipeQueue, RecipeExecutionJobData } from './queueScheduler';
import { publicClient, simulateRecipeStep } from '../simulation/staticSimulationEngine';
import {
  buildAutoCompounderCallData,
  buildDcaCallData,
  buildRebalancerCallData,
} from '../simulation/recipePayloads';
import { CONTRACT_ADDRESSES, RECIPE_GUARDRAIL_ABI } from '../config/contracts';
import {
  ARC_CIRBTC_ADDRESS,
  ARC_EURC_ADDRESS,
  ARC_USDC_ADDRESS,
  DEFAULT_DCA_MAX_SLIPPAGE_BPS,
  parseDcaMaxSlippageBpsWithFallback,
  parseDcaTargetAssetSymbolWithFallback,
} from '../config/dcaRouting';
import { RUNTIME_CONFIG } from '../config/runtime';
import { incrementCounter, readCounter, recordCronCycle } from '../observability/metrics';
import { recipesRepository } from '../db/repositories/recipesRepository';
const AUTO_COMPOUNDER_LENDING_BORROWING_ADDRESS = CONTRACT_ADDRESSES.autoCompounderLendingBorrowing;
import { getKeeperAccount } from '../index';
import { createDcaSwapRouteClientFromRuntime } from '../integrations/circle/dcaSwapRouteClient';
const USDC_DECIMALS = 6n;
const USDC_BASE = 10n ** USDC_DECIMALS;
const DEFAULT_DCA_USDC_BASE_UNITS = 50_000_000n; // 50 USDC
const MAX_USDC_SPEND_PER_TX_BASE_UNITS = 500_000_000n; // 500 USDC
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
const executorNotApprovedHintsLogged = new Set<string>();
const guardrailOwnerCache = { owner: null as `0x${string}` | null, checkedAtMs: 0 };
const GUARDRAIL_OWNER_CACHE_TTL_MS = 5 * 60 * 1000;
const CLAIMABLE_REWARDS_CACHE_TTL_MS = 30 * 1000;
const claimableRewardsCache = new Map<string, { amount: bigint; checkedAtMs: number }>();
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

const RECIPE_SELECTOR_LABEL: Partial<Record<RecipeType, string>> = {
  AUTO_COMPOUNDER: 'claimRewardsForUser(address)',
  RECURRING_DCA: 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)',
  SMART_YIELD_REBALANCER: 'withdrawForUser(address,uint256)',
};

interface RecipeParameters {
  checkIntervalHours?: number;
  dcaAmountUsdc?: string;
  dcaAmountUsdcBaseUnits?: string;
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

  if (typeof raw.dcaAmountUsdc === 'string') {
    parsed.dcaAmountUsdc = raw.dcaAmountUsdc;
  }

  if (typeof raw.dcaAmountUsdcBaseUnits === 'string') {
    parsed.dcaAmountUsdcBaseUnits = raw.dcaAmountUsdcBaseUnits;
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

function resolveDcaTargetAssetSymbol(recipeParams: RecipeParameters, context: string): string {
  const symbolResult = parseDcaTargetAssetSymbolWithFallback(recipeParams.targetAssetSymbol);
  if (symbolResult.usedFallback) {
    console.warn(
      `[Cron Scheduler Warning] Invalid or missing targetAssetSymbol ${context}. ` +
      `Using fallback=cirBTC for Arc Testnet compatibility.`
    );
  }
  return symbolResult.targetAssetSymbol;
}

function resolveDcaTargetAssetAddress(targetAssetSymbol: string): `0x${string}` {
  if (targetAssetSymbol === 'cirBTC') {
    return ARC_CIRBTC_ADDRESS;
  }

  if (targetAssetSymbol === 'EURC') {
    return ARC_EURC_ADDRESS;
  }

  throw new Error('RECURRING_DCA targetAssetSymbol cannot be USDC; use EURC or cirBTC.');
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

function parseDcaAmountUsdcBaseUnits(params: RecipeParameters): bigint {
  const rawBaseUnits = params.dcaAmountUsdcBaseUnits?.trim();
  if (rawBaseUnits) {
    if (!/^\d+$/.test(rawBaseUnits)) {
      throw new Error('dcaAmountUsdcBaseUnits must be a positive integer string in USDC base units.');
    }
    const amount = BigInt(rawBaseUnits);
    if (amount <= 0n || amount > MAX_USDC_SPEND_PER_TX_BASE_UNITS) {
      throw new Error('dcaAmountUsdcBaseUnits is outside allowed per-tx USDC spend limits.');
    }
    return amount;
  }

  const rawUsdc = params.dcaAmountUsdc?.trim();
  if (!rawUsdc) {
    return DEFAULT_DCA_USDC_BASE_UNITS;
  }

  if (!/^\d+(\.\d{1,6})?$/.test(rawUsdc)) {
    throw new Error('dcaAmountUsdc must be a numeric USDC amount with up to 6 decimals.');
  }

  let amountBaseUnits: bigint;
  if (rawUsdc.includes('.')) {
    const [wholePartRaw, fractionalRaw] = rawUsdc.split('.');
    const wholePart = BigInt(wholePartRaw);
    const fractionalPadded = (fractionalRaw + '000000').slice(0, 6);
    const fractionalPart = BigInt(fractionalPadded);
    amountBaseUnits = wholePart * USDC_BASE + fractionalPart;
  } else {
    const whole = BigInt(rawUsdc);
    // Backward compatibility: legacy records may already store 6-decimal base units.
    amountBaseUnits = whole >= USDC_BASE ? whole : whole * USDC_BASE;
  }

  if (amountBaseUnits <= 0n || amountBaseUnits > MAX_USDC_SPEND_PER_TX_BASE_UNITS) {
    throw new Error('dcaAmountUsdc is outside allowed per-tx USDC spend limits.');
  }

  return amountBaseUnits;
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

function maybeLogProtocolNotWhitelistedHint(targetProtocol: `0x${string}`, guardrailOwnerAddress: `0x${string}`) {
  const hintKey = targetProtocol.toLowerCase();
  if (protocolNotAllowedHintsLogged.has(hintKey)) {
    return;
  }

  console.warn(
    `[Cron Scheduler Action Required] Guardrail blocks protocol=${targetProtocol} because it is not whitelisted. ` +
    `From RecipeGuardrail owner wallet ${guardrailOwnerAddress}, call setProtocolWhitelist(${targetProtocol}, true).`
  );
  protocolNotAllowedHintsLogged.add(hintKey);
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

        // AUTO_COMPOUNDER always targets the current LendingBorrowing deployment.
        // RECURRING_DCA may resolve runtime route execution target from App Kit.
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
          const dcaAmount = parseDcaAmountUsdcBaseUnits(recipeParams);
          const maxSlippageBps = resolveDcaMaxSlippageBps(recipeParams, context);
          const targetAssetSymbol = resolveDcaTargetAssetSymbol(recipeParams, context);

          if (recipe.swapProvider === 'ARC_APP_KIT_SWAP') {
            try {
              const routePlan = await dcaSwapRouteClient.resolveRoute({
                recipientAddress: recipe.userAddress as `0x${string}`,
                amountInBaseUnits: dcaAmount,
                maxSlippageBps,
                targetAssetSymbol,
              });

              targetProtocol = routePlan.targetProtocolAddress;
              callData = routePlan.callData;
            } catch (routeError: unknown) {
              const routeErrorMessage = routeError instanceof Error ? routeError.message : String(routeError);

              if (!isArcAppKitNoRouteError(routeErrorMessage)) {
                throw routeError;
              }

              if (!targetProtocol) {
                console.warn(
                  `[Cron Scheduler Action Required] App Kit has no swap route ${context}. ` +
                  `Register this DCA with a deployed DEX router targetProtocol fallback, reduce dcaAmountUsdc, ` +
                  `or relax maxSlippageBps to widen route availability.`
                );
                continue;
              }

              const minAssetOut = (dcaAmount * BigInt(10_000 - maxSlippageBps)) / 10_000n;
              const targetAssetAddress = resolveDcaTargetAssetAddress(targetAssetSymbol);
              callData = buildDcaCallData(
                dcaAmount,
                minAssetOut,
                ARC_USDC_ADDRESS,
                targetAssetAddress,
                recipe.userAddress as `0x${string}`
              );

              console.warn(
                `[Cron Scheduler Notice] App Kit reported no route ${context}. ` +
                `Falling back to configured targetProtocol=${targetProtocol}.`
              );
            }
          } else {
            const minAssetOut = (dcaAmount * BigInt(10_000 - maxSlippageBps)) / 10_000n;
            const targetAssetAddress = resolveDcaTargetAssetAddress(targetAssetSymbol);
            callData = buildDcaCallData(
              dcaAmount,
              minAssetOut,
              ARC_USDC_ADDRESS,
              targetAssetAddress,
              recipe.userAddress as `0x${string}`
            );
          }

          // Keep spend accounting explicit: this value is consumed by SessionKeyRegistry via SharedExecutorProxy.
          const delegatedUsdcSpendAmount = dcaAmount;
          minAmountOut = delegatedUsdcSpendAmount.toString();
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

        const selectorHex = extractSelectorFromCallData(callData);
        const guardrailOwnerAddress = await getGuardrailOwnerAddress();

        const isProtocolAllowed = await isProtocolWhitelisted(targetProtocol as `0x${string}`);
        if (!isProtocolAllowed) {
          maybeLogProtocolNotWhitelistedHint(targetProtocol as `0x${string}`, guardrailOwnerAddress);
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
  claimableRewardsCache.clear();
  dedicatedReadClientCache.clear();

  guardrailOwnerCache.owner = null;
  guardrailOwnerCache.checkedAtMs = 0;
}