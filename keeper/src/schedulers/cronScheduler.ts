import { PrismaClient, RecipeStatus, RecipeType } from '@prisma/client';
import { recipeQueue, RecipeExecutionJobData } from './queueScheduler';
import { publicClient, simulateRecipeStep } from '../simulation/staticSimulationEngine';
import {
  buildAutoCompounderCallData,
  buildDcaCallData,
  buildRebalancerCallData,
} from '../simulation/recipePayloads';
import { CONTRACT_ADDRESSES, RECIPE_GUARDRAIL_ABI } from '../config/contracts';
import { getKeeperAccount } from '../index';

const prisma = new PrismaClient();
const USDC_DECIMALS = 6n;
const USDC_BASE = 10n ** USDC_DECIMALS;
const DEFAULT_DCA_USDC_BASE_UNITS = 50_000_000n; // 50 USDC
const MAX_USDC_SPEND_PER_TX_BASE_UNITS = 500_000_000n; // 500 USDC
const MIN_CHECK_INTERVAL_HOURS = 1;
const MAX_CHECK_INTERVAL_HOURS = 24 * 30;
const SIMULATION_RATE_LIMIT_BACKOFF_MS = 45_000;

let simulationBackoffUntilMs = 0;
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

const RECIPE_SELECTOR_LABEL: Partial<Record<RecipeType, string>> = {
  AUTO_COMPOUNDER: 'claimRewardsForUser(address)',
  RECURRING_DCA: 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)',
  SMART_YIELD_REBALANCER: 'withdrawForUser(address,uint256)',
};

interface RecipeParameters {
  checkIntervalHours?: number;
  dcaAmountUsdc?: string;
  dcaAmountUsdcBaseUnits?: string;
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

  return parsed;
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

async function getGuardrailOwnerAddress(): Promise<`0x${string}`> {
  const now = Date.now();
  if (guardrailOwnerCache.owner && now - guardrailOwnerCache.checkedAtMs < GUARDRAIL_OWNER_CACHE_TTL_MS) {
    return guardrailOwnerCache.owner;
  }

  const owner = (await publicClient.readContract({
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
  })) as `0x${string}`;

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

  const bytecode = await publicClient.getBytecode({ address: targetProtocol });
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

  const isAllowed = (await publicClient.readContract({
    address: CONTRACT_ADDRESSES.recipeGuardrail,
    abi: RECIPE_GUARDRAIL_ABI,
    functionName: 'isSelectorAllowed',
    args: [targetProtocol, selectorHex],
  })) as boolean;

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

  const isAllowed = (await publicClient.readContract({
    address: CONTRACT_ADDRESSES.recipeGuardrail,
    abi: RECIPE_GUARDRAIL_ABI,
    functionName: 'isProtocolWhitelisted',
    args: [targetProtocol],
  })) as boolean;

  protocolAllowedCache.set(cacheKey, { isAllowed, checkedAtMs: now });
  return isAllowed;
}

/**
 * Periodically queries active recipes in Prisma DB, evaluates trigger conditions,
 * runs pre-flight eth_call static simulation, and enqueues jobs to BullMQ.
 */
export async function pollAndTriggerActiveRecipes() {
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

    const activeRecipes = await prisma.activeRecipe.findMany({
      where: { status: RecipeStatus.ACTIVE },
    });

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
        const targetProtocol = recipe.targetProtocol as `0x${string}`;

        const hasTargetProtocolCode = await targetProtocolHasCode(targetProtocol);
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

        if (recipe.recipeType === RecipeType.AUTO_COMPOUNDER) {
          callData = buildAutoCompounderCallData(recipe.userAddress as `0x${string}`);
          minAmountOut = '5000000'; // 5 USDC min output
        } else if (recipe.recipeType === RecipeType.RECURRING_DCA) {
          const dcaAmount = parseDcaAmountUsdcBaseUnits(recipeParams);
          const minAssetOut = (dcaAmount * 995n) / 1000n; // 0.5% slippage cap
          const wethAddress = '0x4200000000000000000000000000000000000006';
          callData = buildDcaCallData(
            dcaAmount,
            minAssetOut,
            '0x3600000000000000000000000000000000000000',
            wethAddress,
            recipe.userAddress as `0x${string}`
          );
          // DCA spend is denominated in USDC; proxy uses this value for delegated spend accounting.
          minAmountOut = dcaAmount.toString();
        } else if (recipe.recipeType === RecipeType.SMART_YIELD_REBALANCER) {
          callData = buildRebalancerCallData(recipe.userAddress as `0x${string}`, 100000000n);
          minAmountOut = '100000000';
        }

        const selectorHex = extractSelectorFromCallData(callData);
        const guardrailOwnerAddress = await getGuardrailOwnerAddress();

        const isProtocolAllowed = await isProtocolWhitelisted(targetProtocol);
        if (!isProtocolAllowed) {
          maybeLogProtocolNotWhitelistedHint(targetProtocol, guardrailOwnerAddress);
          continue;
        }

        const isSelectorAllowed = await isSelectorAllowedForProtocol(targetProtocol, selectorHex);
        if (!isSelectorAllowed) {
          maybeLogSelectorNotAllowedHint(targetProtocol, selectorHex, recipe.recipeType, guardrailOwnerAddress);
          continue;
        }

        // Pre-flight static simulation via eth_call
        const simResult = await simulateRecipeStep({
          userAddress: recipe.userAddress as `0x${string}`,
          executorProxyAddress: CONTRACT_ADDRESSES.sharedExecutorProxy as `0x${string}`,
          targetProtocolAddress: targetProtocol,
          callData,
          minAmountOut: BigInt(minAmountOut),
          keeperAddress: keeperAccount.address,
        });

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
            maybeLogSelectorNotAllowedHint(targetProtocol, selectorHex, recipe.recipeType, guardrailOwnerAddress);
          }

          if (isExecutorNotApprovedError(simulationError)) {
            maybeLogExecutorNotApprovedHint(targetProtocol);
          }

          if (isSimulationRateLimitError(simulationError)) {
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
          targetProtocolAddress: targetProtocol,
          callData,
          minAmountOut,
          keeperAddress: keeperAccount.address,
        };

        const executionBucket = Math.floor(now.getTime() / (intervalHours * 60 * 60 * 1000));
        const jobId = `execute-${recipe.id}-${executionBucket}`;
        await recipeQueue.add(jobId, jobData, { jobId });
        console.log(`[Cron Scheduler] Enqueued recipe ${context} jobId=${jobId}`);
      } catch (recipeErr: unknown) {
        const recipeErrorMessage = recipeErr instanceof Error ? recipeErr.message : 'Unknown recipe scheduling error';
        console.warn(`[Cron Scheduler Notice] Skipping recipe ${recipeLogContext(recipe)}: ${recipeErrorMessage}`);
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown scheduler error';
    console.warn(`[Cron Scheduler Error] ${message}`);
  }
}

let cronTimer: NodeJS.Timeout | null = null;

export function startCronScheduler(intervalMs: number = 30_000) {
  console.log(`[Cron Scheduler] Active recipe poll scheduler started (Interval: ${intervalMs / 1000}s)`);
  pollAndTriggerActiveRecipes();
  cronTimer = setInterval(pollAndTriggerActiveRecipes, intervalMs);
}

export function stopCronScheduler() {
  if (cronTimer) {
    clearInterval(cronTimer);
    cronTimer = null;
  }
}
