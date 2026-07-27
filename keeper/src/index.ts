import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createWalletClient, http, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from 'viem/chains';
import { ARC_TESTNET_CONFIG, CONTRACT_ADDRESSES } from './config/contracts';
import { recipeQueue, recipeWorker, executeRecipeStepDirectly } from './schedulers/queueScheduler';
import { startCronScheduler, stopCronScheduler } from './schedulers/cronScheduler';

export const prisma = new PrismaClient();

const KEEPER_PRIVATE_KEY = (process.env.KEEPER_PRIVATE_KEY) as `0x${string}`;

export function getKeeperAccount() {
  return privateKeyToAccount(KEEPER_PRIVATE_KEY);
}

export function getKeeperWalletClient() {
  const account = getKeeperAccount();
  return createWalletClient({
    account,
    chain: arcTestnet,
    transport: http(ARC_TESTNET_CONFIG.rpcUrl),
  });
}

/**
 * Main Keeper Engine Entrypoint
 */
export async function startKeeperEngine() {
  console.log('====================================================');
  console.log('     DeFi Recipes on Arc - Off-Chain Keeper Engine   ');
  console.log('====================================================');

  const account = getKeeperAccount();
  console.log(`[Config] Arc Chain ID           : ${ARC_TESTNET_CONFIG.chainId}`);
  console.log(`[Config] Arc RPC URL            : ${ARC_TESTNET_CONFIG.rpcUrl}`);
  console.log(`[Config] Keeper Address         : ${account.address}`);
  console.log(`[Config] Shared Executor Proxy   : ${CONTRACT_ADDRESSES.sharedExecutorProxy}`);
  console.log(`[Config] Recipe Guardrail       : ${CONTRACT_ADDRESSES.recipeGuardrail}`);
  console.log(`[Config] Session Key Registry   : ${CONTRACT_ADDRESSES.sessionKeyRegistry}`);

  // Test Database Connection via Prisma
  try {
    await prisma.$connect();
    const activeRecipesCount = await prisma.activeRecipe.count();
    console.log(`[Database] PostgreSQL connected successfully. Active recipes in DB: ${activeRecipesCount}`);
  } catch (err: any) {
    console.warn(`[Database Warning] Could not query database: ${err.message}`);
  }

  // Start Cron Poll Scheduler
  startCronScheduler(30_000);

  // Setup process exit handlers for graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[Keeper Engine] Shutting down gracefully...');
    stopCronScheduler();
    await recipeWorker.close();
    await recipeQueue.close();
    await prisma.$disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n[Keeper Engine] Received SIGTERM. Shutting down...');
    stopCronScheduler();
    await recipeWorker.close();
    await recipeQueue.close();
    await prisma.$disconnect();
    process.exit(0);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('[Keeper Engine] Unhandled Rejection at:', promise, 'reason:', reason);
  });

  console.log('[Keeper Engine] Queue Worker & Scheduler operational. Listening for recipes...');
}

if (require.main === module) {
  startKeeperEngine().catch((err) => {
    console.error('[Keeper Engine Fatal Error]', err);
    process.exit(1);
  });
}
