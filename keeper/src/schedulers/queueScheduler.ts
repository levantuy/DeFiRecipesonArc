import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from 'viem/chains';
import { ExecutionStatus, RecipeStatus } from '../db/types';
import { simulateRecipeStep, SimulationRequest, publicClient } from '../simulation/staticSimulationEngine';
import { ARC_TESTNET_CONFIG, SHARED_EXECUTOR_PROXY_ABI } from '../config/contracts';
import { getKeeperPrivateKey, RUNTIME_CONFIG } from '../config/runtime';
import {
  incrementCounter,
  recordQueueLeadTimeToConfirmed,
  recordQueueLeadTimeToSubmitted,
} from '../observability/metrics';
import { executionLogsRepository } from '../db/repositories/executionLogsRepository';
import { recipesRepository } from '../db/repositories/recipesRepository';
import { applyDcaExecution, parseDcaConfigStateStrict, remainingBudgetBaseUnits, toPersistedDcaParameters } from '../domain/dcaConfig';

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
  const urls = [RUNTIME_CONFIG.arcRpcUrl, ...RUNTIME_CONFIG.arcRpcFallbackUrls];

  return Array.from(new Set(urls.map((entry) => entry.trim()).filter((entry) => entry.length > 0)));
}

export interface RecipeExecutionJobData {
  recipeId: string;
  recipeType?: string;
  userAddress: `0x${string}`;
  executorProxyAddress: `0x${string}`;
  targetProtocolAddress: `0x${string}`;
  callData: `0x${string}`;
  // Forwarded to SharedExecutorProxy.executeRecipeStep(minAmountOut).
  // For DCA, this is delegated USDC spend accounting (not swap output minimum).
  // Swap output slippage floor is encoded inside callData (amountOutMin).
  minAmountOut: string;
  keeperAddress: `0x${string}`;
  queueEnqueuedAtMs?: number;
  preflightSimulationPassed?: boolean;
  preflightEstimatedGasUsdc?: string;
  dcaMode?: 'PREFUND' | 'PULL';
  dcaExecutionAmountBaseUnits?: string;
}

export interface TxConfirmationJobData {
  recipeId: string;
  txHash: `0x${string}`;
  executionLogId: string | null;
  queueEnqueuedAtMs?: number;
  txSubmittedAtMs: number;
  preflightEstimatedGasUsdc?: string;
  dcaMode?: 'PREFUND' | 'PULL';
  dcaExecutionAmountBaseUnits?: string;
}

async function persistDcaExecutionProgress(data: TxConfirmationJobData): Promise<void> {
  if (!data.dcaExecutionAmountBaseUnits) {
    return;
  }

  const recipe = await recipesRepository.findById(data.recipeId);
  if (!recipe || recipe.recipeType !== 'RECURRING_DCA') {
    return;
  }

  const currentState = parseDcaConfigStateStrict(recipe.parametersJson);
  const nextState = applyDcaExecution(currentState, BigInt(data.dcaExecutionAmountBaseUnits));
  const nextParameters = toPersistedDcaParameters(
    recipe.parametersJson as Record<string, unknown>,
    nextState
  );

  await recipesRepository.updateParametersJson(recipe.id, nextParameters);

  const remaining = remainingBudgetBaseUnits(nextState);
  console.info(
    `[DCA_EVENT] DcaExecuted(user=${recipe.userAddress}, executionAmount=${data.dcaExecutionAmountBaseUnits}, ` +
    `totalSpent=${nextState.spentAmountBaseUnits.toString()}, remainingBudget=${remaining.toString()})`
  );

  if (nextState.status === 'COMPLETED' && recipe.status === RecipeStatus.ACTIVE) {
    await recipesRepository.updateStatus(recipe.id, RecipeStatus.COMPLETED);
    console.info(
      `[DCA_EVENT] DcaCompleted(user=${recipe.userAddress}, totalBudget=${nextState.totalBudgetBaseUnits.toString()}, ` +
      `totalSpent=${nextState.spentAmountBaseUnits.toString()})`
    );
  }
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

export const txConfirmationQueue = new Queue<TxConfirmationJobData>('tx-confirmation-queue', {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: 500,
    removeOnFail: 1000,
  },
});

async function markExecutionReverted(executionLogId: string | null, message: string) {
  if (!executionLogId) {
    return;
  }

  await executionLogsRepository
    .updateLogStatus({
      executionLogId,
      status: ExecutionStatus.REVERTED,
      errorMessage: message,
    })
    .catch(() => {
      console.warn('[Keeper Engine] Failed to persist reverted execution log.');
    });
}

async function waitForReceiptAndPersist(data: TxConfirmationJobData): Promise<void> {
  incrementCounter('rpc.total');
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: data.txHash,
    timeout: RUNTIME_CONFIG.keeperTxReceiptTimeoutMs,
  });

  if (receipt.status !== 'success') {
    await markExecutionReverted(data.executionLogId, `Transaction failed on-chain: ${data.txHash}`);
    throw new Error(`Transaction failed on-chain: ${data.txHash}`);
  }

  if (data.executionLogId) {
    await executionLogsRepository
      .updateLogStatus({
        executionLogId: data.executionLogId,
        status: ExecutionStatus.CONFIRMED,
        gasUsedUsdc: receipt.gasUsed ? (Number(receipt.gasUsed) / 1e6).toString() : null,
      })
      .catch(() => {
        console.warn('[Keeper Engine] Failed to persist confirmed execution log.');
      });
  }

  await persistDcaExecutionProgress(data).catch((error: unknown) => {
    const message = getErrorMessage(error);
    console.warn(`[Keeper Engine] Failed to persist DCA progress for recipeId=${data.recipeId}: ${message}`);
  });

  await recipesRepository
    .updateLastExecutedAt(data.recipeId, new Date())
    .catch(() => {
      console.warn(`[Keeper Engine] Failed to update lastExecutedAt for recipeId=${data.recipeId}.`);
    });

  incrementCounter('queue.confirmed');
  if (data.queueEnqueuedAtMs) {
    recordQueueLeadTimeToConfirmed(Date.now() - data.queueEnqueuedAtMs);
  }
}

async function enqueueConfirmation(data: TxConfirmationJobData) {
  const jobId = `confirm-${data.recipeId}-${data.txHash}`;
  await txConfirmationQueue.add(jobId, data, {
    jobId,
    attempts: RUNTIME_CONFIG.keeperTxConfirmMaxAttempts,
    backoff: {
      type: 'fixed',
      delay: RUNTIME_CONFIG.keeperTxConfirmRetryDelayMs,
    },
  });
}

/**
 * Direct execution function (used by Worker or direct invocation)
 */
export async function executeRecipeStepDirectly(data: RecipeExecutionJobData) {
  const context = getRecipeLogContext(data);
  console.log(`[Keeper Engine] Executing step ${context}`);

  let executionLogId: string | null = null;
  let hasPersistedRecipe = false;

  try {
    const recipeExists = await recipesRepository.findById(data.recipeId);
    if (recipeExists) {
      hasPersistedRecipe = true;
      const log = await executionLogsRepository.createSimulatingLog(data.recipeId);
      executionLogId = log.id;
    }
  } catch {
    // Ignore DB log creation error if recipe is non-persisted or mock
  }

  const runDynamicSimulation = !data.preflightSimulationPassed;
  let estimatedGasUsdc = data.preflightEstimatedGasUsdc;

  if (runDynamicSimulation) {
    const simReq: SimulationRequest = {
      userAddress: data.userAddress,
      executorProxyAddress: data.executorProxyAddress,
      targetProtocolAddress: data.targetProtocolAddress,
      callData: data.callData,
      minAmountOut: BigInt(data.minAmountOut),
      keeperAddress: data.keeperAddress,
    };

    const simResult = await simulateRecipeStep(simReq, {
      includeGasEstimate: RUNTIME_CONFIG.simulationEstimateGas,
    });

    if (!simResult.success) {
      console.error(`[Simulation Failed] ${context}: ${simResult.errorMessage}`);
      if (executionLogId) {
        await executionLogsRepository
          .updateLogStatus({
            executionLogId,
            status: ExecutionStatus.SIMULATION_FAILED,
            errorMessage: simResult.errorMessage,
          })
          .catch(() => {
            console.warn('[Keeper Engine] Failed to persist simulation failure log.');
          });
      }
      throw new Error(`Simulation Failed: ${simResult.errorMessage}`);
    }

    if (simResult.estimatedGasUsdc) {
      estimatedGasUsdc = simResult.estimatedGasUsdc.toString();
    }
  }

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
      incrementCounter('rpc.total');
      console.log(`[Tx Relayer] ${context} attempt ${attempt}/${maxRetries} submitting via ${rpcUrl}...`);
      hash = await walletClient.writeContract({
        address: data.executorProxyAddress,
        abi: SHARED_EXECUTOR_PROXY_ABI,
        functionName: 'executeRecipeStep',
        args: [data.userAddress, data.targetProtocolAddress, data.callData, BigInt(data.minAmountOut)],
      });
      break;
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      lastError = err instanceof Error ? err : new Error(message);
      console.warn(`[Tx Relayer Warning] ${context} attempt ${attempt} failed: ${message}`);

      if (isRateLimitError(err)) {
        incrementCounter('rpc.rateLimited');
      }

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
    await markExecutionReverted(executionLogId, lastError?.message || 'Execution failed after retries');
    throw lastError || new Error('Tx broadcast failed after max retries');
  }

  console.log(`[Tx Submitted] ${context} txHash=${hash}`);
  incrementCounter('queue.submitted');

  if (data.queueEnqueuedAtMs) {
    recordQueueLeadTimeToSubmitted(Date.now() - data.queueEnqueuedAtMs);
  }

  if (executionLogId) {
    await executionLogsRepository
      .updateLogStatus({
        executionLogId,
        status: ExecutionStatus.SUBMITTED,
        txHash: hash,
        executedAt: new Date(),
      })
      .catch(() => {
        console.warn('[Keeper Engine] Failed to persist submitted execution log.');
      });
  }

  const confirmationPayload: TxConfirmationJobData = {
    recipeId: data.recipeId,
    txHash: hash,
    executionLogId,
    queueEnqueuedAtMs: data.queueEnqueuedAtMs,
    txSubmittedAtMs: Date.now(),
    preflightEstimatedGasUsdc: estimatedGasUsdc,
    dcaMode: data.dcaMode,
    dcaExecutionAmountBaseUnits: data.dcaExecutionAmountBaseUnits,
  };

  if (RUNTIME_CONFIG.keeperSyncConfirmationInHotPath) {
    await waitForReceiptAndPersist(confirmationPayload);

    return {
      status: 'SIMULATED_AND_EXECUTED',
      txHash: hash,
      gasUsedUsdc: estimatedGasUsdc,
      confirmationMode: 'sync',
    };
  }

  await enqueueConfirmation(confirmationPayload);

  if (!hasPersistedRecipe) {
    return {
      status: 'SUBMITTED_ASYNC',
      txHash: hash,
      gasUsedUsdc: estimatedGasUsdc,
      confirmationMode: 'async',
    };
  }

  return {
    status: 'SUBMITTED_ASYNC',
    txHash: hash,
    gasUsedUsdc: estimatedGasUsdc,
    confirmationMode: 'async',
  };
}

export const recipeWorker = new Worker<RecipeExecutionJobData>(
  'recipe-execution-queue',
  async (job: Job<RecipeExecutionJobData>) => {
    console.log(`[BullMQ Worker] Processing job ${job.id} ${getRecipeLogContext(job.data)}`);
    return await executeRecipeStepDirectly(job.data);
  },
  {
    connection: redisConnection,
    concurrency: 8,
  }
);

export const txConfirmationWorker = new Worker<TxConfirmationJobData>(
  'tx-confirmation-queue',
  async (job: Job<TxConfirmationJobData>) => {
    const context = `[recipeId=${job.data.recipeId} txHash=${job.data.txHash}]`;
    console.log(`[BullMQ Confirm Worker] Processing job ${job.id} ${context}`);

    try {
      await waitForReceiptAndPersist(job.data);
      return {
        status: 'CONFIRMED',
        txHash: job.data.txHash,
      };
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      const isRetryable = isRetryableRpcError(error);
      const attemptsMade = job.attemptsMade + 1;
      const maxAttempts = job.opts.attempts || 1;

      if (isRetryable && attemptsMade < maxAttempts) {
        if (message.toLowerCase().includes('timeout')) {
          incrementCounter('queue.confirmationTimeouts');
        }
        console.warn(
          `[BullMQ Confirm Worker] Retryable confirmation error ${context} attempt=${attemptsMade}/${maxAttempts}: ${message}`
        );
        throw error;
      }

      await markExecutionReverted(job.data.executionLogId, message);
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 12,
  }
);

recipeWorker.on('error', () => {
  // Silence worker loop connection warnings to keep console clean
});

txConfirmationWorker.on('error', () => {
  // Silence worker loop connection warnings to keep console clean
});
