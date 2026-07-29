import { PrismaClient, RecipeStatus, RecipeType } from '@prisma/client';
import { recipeQueue, RecipeExecutionJobData } from './queueScheduler';
import { simulateRecipeStep } from '../simulation/staticSimulationEngine';
import {
  buildAutoCompounderCallData,
  buildDcaCallData,
  buildRebalancerCallData,
} from '../simulation/recipePayloads';
import { CONTRACT_ADDRESSES } from '../config/contracts';
import { getKeeperAccount } from '../index';

const prisma = new PrismaClient();
const USDC_DECIMALS = 6n;
const USDC_BASE = 10n ** USDC_DECIMALS;
const DEFAULT_DCA_USDC_BASE_UNITS = 50_000_000n; // 50 USDC
const MAX_USDC_SPEND_PER_TX_BASE_UNITS = 500_000_000n; // 500 USDC
const MIN_CHECK_INTERVAL_HOURS = 1;
const MAX_CHECK_INTERVAL_HOURS = 24 * 30;

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

/**
 * Periodically queries active recipes in Prisma DB, evaluates trigger conditions,
 * runs pre-flight eth_call static simulation, and enqueues jobs to BullMQ.
 */
export async function pollAndTriggerActiveRecipes() {
  try {
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
