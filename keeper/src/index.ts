import 'dotenv/config';
import http from 'node:http';
import { PrismaClient } from '@prisma/client';
import { createWalletClient, http as viemHttp } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from 'viem/chains';
import { ARC_TESTNET_CONFIG, CONTRACT_ADDRESSES } from './config/contracts';
import { getKeeperPrivateKey, RUNTIME_CONFIG } from './config/runtime';
import {
  recipeQueue,
  recipeWorker,
  txConfirmationQueue,
  txConfirmationWorker,
  executeRecipeStepDirectly,
} from './schedulers/queueScheduler';
import { startCronScheduler, stopCronScheduler } from './schedulers/cronScheduler';
import { listExecutionLogs, registerOrActivateRecipe, updateRecipeStatus } from './api/recipeSyncApi';
import { getKeeperMetricsSnapshot } from './observability/metrics';

export const prisma = new PrismaClient();

export function getKeeperAccount() {
  return privateKeyToAccount(getKeeperPrivateKey());
}

export function getKeeperWalletClient() {
  const account = getKeeperAccount();
  return createWalletClient({
    account,
    chain: arcTestnet,
    transport: viemHttp(ARC_TESTNET_CONFIG.rpcUrl, {
      timeout: RUNTIME_CONFIG.arcRpcTimeoutMs,
      retryCount: RUNTIME_CONFIG.arcRpcRetryCount,
    }),
  });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown error';
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString('utf8').trim();
  if (rawBody.length === 0) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new Error('Request body must be valid JSON.');
  }
}

function setJsonResponse(res: http.ServerResponse, statusCode: number, payload: Record<string, unknown>) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(JSON.stringify(payload));
}

function createHealthServer(port: number) {
  const startedAt = new Date().toISOString();
  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    const pathName = requestUrl.pathname;
    const method = (req.method || 'GET').toUpperCase();

    if (method === 'OPTIONS') {
      setJsonResponse(res, 204, {});
      return;
    }

    if (pathName === '/recipes/register' && method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const payload = await registerOrActivateRecipe(prisma, body);
        setJsonResponse(res, 200, payload);
      } catch (error: unknown) {
        setJsonResponse(res, 400, {
          success: false,
          error: getErrorMessage(error),
        });
      }
      return;
    }

    if (pathName === '/recipes/status' && method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const payload = await updateRecipeStatus(prisma, body);
        setJsonResponse(res, 200, payload);
      } catch (error: unknown) {
        setJsonResponse(res, 400, {
          success: false,
          error: getErrorMessage(error),
        });
      }
      return;
    }

    if (pathName === '/recipes/logs' && method === 'GET') {
      try {
        const payload = await listExecutionLogs(prisma, {
          userAddress: requestUrl.searchParams.get('userAddress') || undefined,
          limit: requestUrl.searchParams.get('limit') || undefined,
        });
        setJsonResponse(res, 200, payload);
      } catch (error: unknown) {
        setJsonResponse(res, 400, {
          success: false,
          error: getErrorMessage(error),
        });
      }
      return;
    }

    if (pathName === '/metrics' && method === 'GET') {
      setJsonResponse(res, 200, {
        status: 'ok',
        service: 'keeper',
        metrics: getKeeperMetricsSnapshot(),
      });
      return;
    }

    if (pathName !== '/healthz') {
      setJsonResponse(res, 404, { message: 'Not found' });
      return;
    }

    try {
      await prisma.$queryRaw`SELECT 1`;
      setJsonResponse(res, 200, {
        status: 'ok',
        service: 'keeper',
        chainId: ARC_TESTNET_CONFIG.chainId,
        startedAt,
        timestamp: new Date().toISOString(),
      });
    } catch (error: unknown) {
      setJsonResponse(res, 503, {
        status: 'degraded',
        service: 'keeper',
        reason: getErrorMessage(error),
      });
    }
  });

  server.listen(port, () => {
    console.log(`[Health] Keeper health endpoint listening at http://localhost:${port}/healthz`);
  });

  return server;
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
  } catch (err: unknown) {
    console.warn(`[Database Warning] Could not query database: ${getErrorMessage(err)}`);
  }

  const healthServer = createHealthServer(RUNTIME_CONFIG.keeperHealthPort);

  // Start Cron Poll Scheduler
  startCronScheduler(30_000);

  // Setup process exit handlers for graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[Keeper Engine] Shutting down gracefully...');
    stopCronScheduler();
    await recipeWorker.close();
    await txConfirmationWorker.close();
    await recipeQueue.close();
    await txConfirmationQueue.close();
    await new Promise<void>((resolve) => {
      healthServer.close(() => resolve());
    });
    await prisma.$disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n[Keeper Engine] Received SIGTERM. Shutting down...');
    stopCronScheduler();
    await recipeWorker.close();
    await txConfirmationWorker.close();
    await recipeQueue.close();
    await txConfirmationQueue.close();
    await new Promise<void>((resolve) => {
      healthServer.close(() => resolve());
    });
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
