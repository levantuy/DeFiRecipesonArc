import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from 'viem/chains';
import { PrismaClient, ExecutionStatus } from '@prisma/client';
import { simulateRecipeStep, SimulationRequest } from '../simulation/staticSimulationEngine';
import { ARC_TESTNET_CONFIG, SHARED_EXECUTOR_PROXY_ABI } from '../config/contracts';
import { getKeeperPrivateKey, RUNTIME_CONFIG } from '../config/runtime';

const prisma = new PrismaClient();

const REDIS_URL = RUNTIME_CONFIG.redisUrl;
const TX_RETRY_BASE_DELAY_MS = 1500;
const TX_RETRY_MAX_DELAY_MS = 12000;

let lastRedisErrorLogTime = 0;

export const redisConnection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  retryStrategy(times) {
    return Math.min(times * 1000, RUNTIME_CONFIG.redisRetryMaxDelayMs);
  },
});

redisConnection.on('error', (err) => {
  const now = Date.now();
  if (now - lastRedisErrorLogTime > 30000) {
    console.warn(`[Redis Notice] Connection warning (${err.message}). Retrying...`);
    lastRedisErrorLogTime = now;
  }
});

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown error';
}

function serializeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name} ${error.message}`;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isRateLimitError(error: unknown): boolean {
  const normalized = serializeError(error).toLowerCase();
  const hasHttp429 = /\b429\b/.test(normalized) && normalized.includes('too many requests');
  return (
    normalized.includes('request limit reached') ||
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('-32011') ||
    normalized.includes('could not coalesce error') ||
    hasHttp429
  );
}

function isRetryableRpcError(error: unknown): boolean {
  if (isRateLimitError(error)) {
    return true;
  }

  const normalized = serializeError(error).toLowerCase();
  return (
    normalized.includes('timeout') ||
    normalized.includes('timed out') ||
    normalized.includes('network error') ||
    normalized.includes('socket hang up') ||
    normalized.includes('econnreset') ||
    normalized.includes('503') ||
    normalized.includes('temporarily unavailable')
  );
}

function getRetryDelayMs(attempt: number): number {
  const exponentialDelay = Math.min(TX_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), TX_RETRY_MAX_DELAY_MS);
  const jitterMs = Math.floor(Math.random() * 500);
  return exponentialDelay + jitterMs;
}

function getRpcCandidates(): string[] {
  const urls = [
    RUNTIME_CONFIG.arcRpcUrl,
    ...RUNTIME_CONFIG.arcRpcFallbackUrls,
  ];

  return Array.from(
    new Set(urls.map((entry) => entry.trim()).filter((entry) => entry.length > 0))
  );
}

export interface RecipeExecutionJobData {
  recipeId: string;
  recipeType?: string;
  userAddress: `0x${string}`;
  executorProxyAddress: `0x${string}`;
  targetProtocolAddress: `0x${string}`;
  callData: `0x${string}`;
  minAmountOut: string; // BigInt serialized as string
  keeperAddress: `0x${string}`;
}

function getRecipeLogContext(data: RecipeExecutionJobData): string {
  return `[recipeId=${data.recipeId} userAddress=${data.userAddress} recipeType=${data.recipeType || 'UNKNOWN'}]`;
}

export const recipeQueue = new Queue<RecipeExecutionJobData>('recipe-execution-queue', {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: 200,
    removeOnFail: 500,
  },
});

/**
 * Direct execution function (used by Worker or direct invocation)
 */
export async function executeRecipeStepDirectly(data: RecipeExecutionJobData) {
  const context = getRecipeLogContext(data);
  console.log(`[Keeper Engine] Executing step ${context}`);

  // Create Execution Log in Database if activeRecipe exists
  let executionLogId: string | null = null;
  let hasPersistedRecipe = false;
  try {
    const recipeExists = await prisma.activeRecipe.findUnique({
      where: { id: data.recipeId },
    });
    if (recipeExists) {
      hasPersistedRecipe = true;
      const log = await prisma.executionLog.create({
        data: {
          activeRecipeId: data.recipeId,
          status: ExecutionStatus.SIMULATING,
        },
      });
      executionLogId = log.id;
    }
  } catch {
    // Ignore DB log creation error if recipe is non-persisted or mock
  }

  // Step 1: Pre-flight static simulation via eth_call
  const simReq: SimulationRequest = {
    userAddress: data.userAddress,
    executorProxyAddress: data.executorProxyAddress,
    targetProtocolAddress: data.targetProtocolAddress,
    callData: data.callData,
    minAmountOut: BigInt(data.minAmountOut),
    keeperAddress: data.keeperAddress,
  };

  const simResult = await simulateRecipeStep(simReq);

  if (!simResult.success) {
    console.error(`[Simulation Failed] ${context}: ${simResult.errorMessage}`);
    if (executionLogId) {
      await prisma.executionLog.update({
        where: { id: executionLogId },
        data: {
          status: ExecutionStatus.SIMULATION_FAILED,
          errorMessage: simResult.errorMessage,
        },
      }).catch(() => {
        console.warn('[Keeper Engine] Failed to persist simulation failure log.');
      });
    }
    throw new Error(`Simulation Failed: ${simResult.errorMessage}`);
  }

  console.log(`[Simulation Passed] Gas Estimate: ${simResult.estimatedGasUsdc} USDC native units`);

  // Step 2: Relayer Transaction Submission with Viem & Exponential Backoff Retry Policy
  const maxRetries = RUNTIME_CONFIG.keeperTxRetryMaxAttempts;
  let attempt = 0;
  let hash: `0x${string}` | null = null;
  let lastError: Error | null = null;

  const account = privateKeyToAccount(getKeeperPrivateKey());
  const rpcCandidates = getRpcCandidates();
  console.log(`[Tx Relayer] ${context} RPC candidates: ${rpcCandidates.join(', ')}`);

  while (attempt < maxRetries) {
    attempt++;
    const rpcUrl = rpcCandidates[(attempt - 1) % rpcCandidates.length] || ARC_TESTNET_CONFIG.rpcUrl;
    const walletClient = createWalletClient({
      account,
      chain: arcTestnet,
      transport: http(rpcUrl, {
        timeout: RUNTIME_CONFIG.arcRpcTimeoutMs,
        retryCount: RUNTIME_CONFIG.arcRpcRetryCount,
      }),
    });

    try {
      console.log(`[Tx Relayer] ${context} attempt ${attempt}/${maxRetries} submitting via ${rpcUrl}...`);
      hash = await walletClient.writeContract({
        address: data.executorProxyAddress,
        abi: SHARED_EXECUTOR_PROXY_ABI,
        functionName: 'executeRecipeStep',
        args: [data.userAddress, data.targetProtocolAddress, data.callData, BigInt(data.minAmountOut)],
      });
      break; // Success, exit retry loop
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      lastError = err instanceof Error ? err : new Error(message);
      console.warn(`[Tx Relayer Warning] ${context} attempt ${attempt} failed: ${message}`);

      const canRetry = isRetryableRpcError(err) && attempt < maxRetries;
      if (canRetry) {
        const backoffMs = getRetryDelayMs(attempt);
        if (isRateLimitError(err) && rpcCandidates.length > 1) {
          const nextRpcUrl = rpcCandidates[attempt % rpcCandidates.length];
          console.warn(`[Tx Relayer Notice] ${context} rate limit on ${rpcUrl}. Switching next retry to ${nextRpcUrl}.`);
        }
        console.log(`[Tx Relayer] ${context} waiting ${backoffMs}ms before retrying...`);
        await new Promise((res) => setTimeout(res, backoffMs));
        continue;
      }

      throw lastError;
    }
  }

  if (!hash) {
    console.error(`[Tx Execution Failed] ${context} after ${maxRetries} attempts: ${lastError?.message}`);
    if (executionLogId) {
      await prisma.executionLog.update({
        where: { id: executionLogId },
        data: {
          status: ExecutionStatus.REVERTED,
          errorMessage: lastError?.message || 'Execution failed after retries',
        },
      }).catch(() => {
        console.warn('[Keeper Engine] Failed to persist reverted execution log.');
      });
    }
    throw lastError || new Error('Tx broadcast failed after max retries');
  }

  console.log(`[Tx Submitted] ${context} txHash=${hash}`);

  if (executionLogId) {
    await prisma.executionLog.update({
      where: { id: executionLogId },
      data: {
        status: ExecutionStatus.SUBMITTED,
        txHash: hash,
        executedAt: new Date(),
      },
    }).catch(() => {
      console.warn('[Keeper Engine] Failed to persist submitted execution log.');
    });
  }

  // Step 3: Verify Sub-Second Finality on Arc Network
  try {
    const { publicClient } = await import('../simulation/staticSimulationEngine');
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: RUNTIME_CONFIG.keeperTxReceiptTimeoutMs,
    });
    console.log(`[Tx Finalized] ${context} block=${receipt.blockNumber} status=${receipt.status}`);

    if (executionLogId && receipt.status === 'success') {
      await prisma.executionLog.update({
        where: { id: executionLogId },
        data: {
          status: ExecutionStatus.CONFIRMED,
          gasUsedUsdc: receipt.gasUsed ? (Number(receipt.gasUsed) / 1e6).toString() : null,
        },
      }).catch(() => { });
    }
  } catch (receiptErr: unknown) {
    console.warn(`[Finality Warning] ${context} could not wait for tx receipt ${hash}: ${getErrorMessage(receiptErr)}`);
  }

  // Update ActiveRecipe lastExecutedAt for persisted recipes.
  if (hasPersistedRecipe) {
    await prisma.activeRecipe.update({
      where: { id: data.recipeId },
      data: { lastExecutedAt: new Date() },
    }).catch(() => {
      console.warn(`[Keeper Engine] Failed to update lastExecutedAt ${context}.`);
    });
  }

  return {
    status: 'SIMULATED_AND_EXECUTED',
    txHash: hash,
    gasUsedUsdc: simResult.estimatedGasUsdc?.toString(),
  };
}

/**
 * BullMQ Worker processing recipe execution jobs.
 */
export const recipeWorker = new Worker<RecipeExecutionJobData>(
  'recipe-execution-queue',
  async (job: Job<RecipeExecutionJobData>) => {
    console.log(`[BullMQ Worker] Processing job ${job.id} ${getRecipeLogContext(job.data)}`);
    return await executeRecipeStepDirectly(job.data);
  },
  {
    connection: redisConnection,
    concurrency: 5,
  }
);

recipeWorker.on('error', () => {
  // Silence worker loop connection warnings to keep console clean
});
