import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from 'viem/chains';
import { PrismaClient, ExecutionStatus } from '@prisma/client';
import { simulateRecipeStep, SimulationRequest } from '../simulation/staticSimulationEngine';
import { ARC_TESTNET_CONFIG, SHARED_EXECUTOR_PROXY_ABI } from '../config/contracts';

const prisma = new PrismaClient();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const KEEPER_PRIVATE_KEY = (process.env.KEEPER_PRIVATE_KEY) as `0x${string}`;

let lastRedisErrorLogTime = 0;

export const redisConnection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  retryStrategy(times) {
    return Math.min(times * 1000, 10000);
  },
});

redisConnection.on('error', (err) => {
  const now = Date.now();
  if (now - lastRedisErrorLogTime > 30000) {
    console.warn(`[Redis Notice] Connection warning (${err.message}). Retrying...`);
    lastRedisErrorLogTime = now;
  }
});

export interface RecipeExecutionJobData {
  recipeId: string;
  userAddress: `0x${string}`;
  executorProxyAddress: `0x${string}`;
  targetProtocolAddress: `0x${string}`;
  callData: `0x${string}`;
  minAmountOut: string; // BigInt serialized as string
  keeperAddress: `0x${string}`;
}

export const recipeQueue = new Queue<RecipeExecutionJobData>('recipe-execution-queue', {
  connection: redisConnection,
});

/**
 * Direct execution function (used by Worker or direct invocation)
 */
export async function executeRecipeStepDirectly(data: RecipeExecutionJobData) {
  console.log(`[Keeper Engine] Executing step for recipe ${data.recipeId}`);

  // Create Execution Log in Database if activeRecipe exists
  let executionLogId: string | null = null;
  try {
    const recipeExists = await prisma.activeRecipe.findUnique({
      where: { id: data.recipeId },
    });
    if (recipeExists) {
      const log = await prisma.executionLog.create({
        data: {
          activeRecipeId: data.recipeId,
          status: ExecutionStatus.SIMULATING,
        },
      });
      executionLogId = log.id;
    }
  } catch (err: any) {
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
    console.error(`[Simulation Failed] Recipe ${data.recipeId}: ${simResult.errorMessage}`);
    if (executionLogId) {
      await prisma.executionLog.update({
        where: { id: executionLogId },
        data: {
          status: ExecutionStatus.SIMULATION_FAILED,
          errorMessage: simResult.errorMessage,
        },
      }).catch(() => { });
    }
    throw new Error(`Simulation Failed: ${simResult.errorMessage}`);
  }

  console.log(`[Simulation Passed] Gas Estimate: ${simResult.estimatedGasUsdc} USDC native units`);

  // Step 2: Relayer Transaction Submission with Viem
  try {
    const account = privateKeyToAccount(KEEPER_PRIVATE_KEY);
    const walletClient = createWalletClient({
      account,
      chain: arcTestnet,
      transport: http(ARC_TESTNET_CONFIG.rpcUrl),
    });

    const hash = await walletClient.writeContract({
      address: data.executorProxyAddress,
      abi: SHARED_EXECUTOR_PROXY_ABI,
      functionName: 'executeRecipeStep',
      args: [data.userAddress, data.targetProtocolAddress, data.callData, BigInt(data.minAmountOut)],
    });

    console.log(`[Tx Submitted] Recipe ${data.recipeId} Tx Hash: ${hash}`);

    if (executionLogId) {
      await prisma.executionLog.update({
        where: { id: executionLogId },
        data: {
          status: ExecutionStatus.SUBMITTED,
          txHash: hash,
          executedAt: new Date(),
        },
      }).catch(() => { });
    }

    // Update ActiveRecipe lastExecutedAt
    await prisma.activeRecipe.update({
      where: { id: data.recipeId },
      data: { lastExecutedAt: new Date() },
    }).catch(() => { });

    return {
      status: 'SIMULATED_AND_EXECUTED',
      txHash: hash,
      gasUsedUsdc: simResult.estimatedGasUsdc?.toString(),
    };
  } catch (err: any) {
    console.error(`[Tx Execution Failed] Recipe ${data.recipeId}: ${err.message}`);
    if (executionLogId) {
      await prisma.executionLog.update({
        where: { id: executionLogId },
        data: {
          status: ExecutionStatus.REVERTED,
          errorMessage: err.message,
        },
      }).catch(() => { });
    }
    throw err;
  }
}

/**
 * BullMQ Worker processing recipe execution jobs.
 */
export const recipeWorker = new Worker<RecipeExecutionJobData>(
  'recipe-execution-queue',
  async (job: Job<RecipeExecutionJobData>) => {
    console.log(`[BullMQ Worker] Processing job ${job.id} for recipe ${job.data.recipeId}`);
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
