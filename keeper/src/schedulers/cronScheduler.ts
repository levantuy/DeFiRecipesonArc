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
      const now = new Date();
      const lastExecuted = recipe.lastExecutedAt ? new Date(recipe.lastExecutedAt) : new Date(0);
      const diffHours = (now.getTime() - lastExecuted.getTime()) / (1000 * 60 * 60);

      // Default interval threshold: 24 hours between triggers unless overridden
      const intervalHours = (recipe.parametersJson as any)?.checkIntervalHours || 24;
      if (diffHours < intervalHours) {
        continue; // Not due yet
      }

      let callData: `0x${string}` = '0x';
      let minAmountOut = '0';
      const targetProtocol = recipe.targetProtocol as `0x${string}`;

      if (recipe.recipeType === RecipeType.AUTO_COMPOUNDER) {
        callData = buildAutoCompounderCallData(recipe.userAddress as `0x${string}`);
        minAmountOut = '5000000'; // 5 USDC min output
      } else if (recipe.recipeType === RecipeType.RECURRING_DCA) {
        const dcaAmount = BigInt((recipe.parametersJson as any)?.dcaAmountUsdc || '50000000');
        const minAssetOut = (dcaAmount * 995n) / 1000n; // 0.5% slippage cap
        const wethAddress = '0x4200000000000000000000000000000000000006';
        callData = buildDcaCallData(
          dcaAmount,
          minAssetOut,
          '0x3600000000000000000000000000000000000000',
          wethAddress,
          recipe.userAddress as `0x${string}`
        );
        minAmountOut = '0';
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
        console.warn(`[Cron Scheduler Notice] Recipe ${recipe.id} simulation failed: ${simResult.errorMessage}. Skipping enqueue.`);
        continue;
      }

      // Enqueue job to recipeQueue
      const jobData: RecipeExecutionJobData = {
        recipeId: recipe.id,
        userAddress: recipe.userAddress as `0x${string}`,
        executorProxyAddress: CONTRACT_ADDRESSES.sharedExecutorProxy as `0x${string}`,
        targetProtocolAddress: targetProtocol,
        callData,
        minAmountOut,
        keeperAddress: keeperAccount.address,
      };

      await recipeQueue.add(`execute-${recipe.id}-${Date.now()}`, jobData);
      console.log(`[Cron Scheduler] Enqueued recipe ${recipe.id} to execution queue.`);
    }
  } catch (err: any) {
    console.warn(`[Cron Scheduler Error] ${err.message}`);
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
