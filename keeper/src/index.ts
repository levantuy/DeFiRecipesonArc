import 'dotenv/config';
import http from 'node:http';
import { createWalletClient, http as viemHttp, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from 'viem/chains';
import { ARC_TESTNET_CONFIG, CONTRACT_ADDRESSES } from './config/contracts';
import { getKeeperPrivateKey, RUNTIME_CONFIG } from './config/runtime';
import {
  recipeQueue,
  recipeWorker,
  txConfirmationQueue,
  txConfirmationWorker,
} from './schedulers/queueScheduler';
import { startCronScheduler, stopCronScheduler } from './schedulers/cronScheduler';
import {
  getSessionSpendQuota,
  listActiveRecipes,
  listExecutionLogs,
  precheckDcaAllowance,
  registerOrActivateRecipe,
  updateRecipeStatus,
} from './api/recipeSyncApi';
import { getKeeperMetricsSnapshot } from './observability/metrics';
import { checkDbHealth, connectDb, countActiveRecipes, disconnectDb } from './db/client';

export function getKeeperAccount() {
  return privateKeyToAccount(getKeeperPrivateKey());
}

export function getKeeperWalletClient(): WalletClient {
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
  res.end(JSON.stringify(payload));
}

function isProtectedPath(pathName: string): boolean {
  return pathName.startsWith('/recipes/') || pathName === '/metrics';
}

function getClientIp(req: http.IncomingMessage): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
    return forwardedFor.split(',')[0]?.trim() || 'unknown';
  }

  if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
    return forwardedFor[0]?.trim() || 'unknown';
  }

  return req.socket.remoteAddress || 'unknown';
}

function normalizeIp(ip: string): string {
  const trimmed = ip.trim();
  if (trimmed.startsWith('::ffff:')) {
    return trimmed.slice(7);
  }
  return trimmed;
}

function isInternalIp(ip: string): boolean {
  const normalized = normalizeIp(ip);
  if (
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized.startsWith('10.') ||
    normalized.startsWith('192.168.')
  ) {
    return true;
  }

  if (normalized.startsWith('172.')) {
    const segments = normalized.split('.');
    const secondOctet = Number(segments[1]);
    if (Number.isInteger(secondOctet) && secondOctet >= 16 && secondOctet <= 31) {
      return true;
    }
  }

  if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')) {
    return true;
  }

  return false;
}

function isInternalOnlyPath(pathName: string): boolean {
  return RUNTIME_CONFIG.keeperInternalOnlyPaths.includes(pathName);
}

function enforceInternalOnlyPolicy(req: http.IncomingMessage, pathName: string, res: http.ServerResponse): boolean {
  if (!RUNTIME_CONFIG.keeperInternalOnlyEnforced) {
    return true;
  }

  if (!isInternalOnlyPath(pathName)) {
    return true;
  }

  const clientIp = getClientIp(req);
  if (isInternalIp(clientIp)) {
    return true;
  }

  setJsonResponse(res, 403, {
    success: false,
    error: 'This endpoint is restricted to internal network access.',
  });
  return false;
}

function applyCorsHeaders(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const originHeader = req.headers.origin;
  const allowedOrigins = new Set(RUNTIME_CONFIG.keeperCorsAllowedOrigins);

  if (!originHeader) {
    res.setHeader('Vary', 'Origin');
    return true;
  }

  if (allowedOrigins.has(originHeader)) {
    res.setHeader('Access-Control-Allow-Origin', originHeader);
    res.setHeader('Vary', 'Origin');
    return true;
  }

  setJsonResponse(res, 403, {
    success: false,
    error: 'Origin is not allowed by CORS policy.',
  });
  return false;
}

function setCommonResponseHeaders(res: http.ServerResponse) {
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function authorizeRequest(req: http.IncomingMessage, pathName: string, res: http.ServerResponse): boolean {
  if (!isProtectedPath(pathName)) {
    return true;
  }

  if (!RUNTIME_CONFIG.keeperApiRequireAuth) {
    return true;
  }

  const authHeader = req.headers.authorization;
  const tokenPrefix = 'Bearer ';
  const token =
    typeof authHeader === 'string' && authHeader.startsWith(tokenPrefix)
      ? authHeader.slice(tokenPrefix.length).trim()
      : '';

  if (token.length === 0 || token !== RUNTIME_CONFIG.keeperApiAuthToken) {
    setJsonResponse(res, 401, {
      success: false,
      error: 'Unauthorized.',
    });
    return false;
  }

  return true;
}

type RateLimitState = {
  windowStartedAtMs: number;
  requestCount: number;
};

const rateLimitByIp = new Map<string, RateLimitState>();

function enforceRateLimit(req: http.IncomingMessage, pathName: string, res: http.ServerResponse): boolean {
  if (!isProtectedPath(pathName)) {
    return true;
  }

  const now = Date.now();
  const key = getClientIp(req);
  const windowMs = RUNTIME_CONFIG.keeperApiRateLimitWindowMs;
  const maxRequests = RUNTIME_CONFIG.keeperApiRateLimitMaxRequests;

  const current = rateLimitByIp.get(key);
  if (!current || now - current.windowStartedAtMs >= windowMs) {
    rateLimitByIp.set(key, {
      windowStartedAtMs: now,
      requestCount: 1,
    });
    return true;
  }

  current.requestCount += 1;
  if (current.requestCount > maxRequests) {
    const retryAfterSeconds = Math.ceil((windowMs - (now - current.windowStartedAtMs)) / 1000);
    res.setHeader('Retry-After', String(Math.max(retryAfterSeconds, 1)));
    setJsonResponse(res, 429, {
      success: false,
      error: 'Rate limit exceeded. Retry later.',
    });
    return false;
  }

  return true;
}

export function createHealthServer(port: number) {
  const startedAt = new Date().toISOString();
  const keeperAddress = getKeeperAccount().address;
  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    const pathName = requestUrl.pathname;
    const method = (req.method || 'GET').toUpperCase();

    setCommonResponseHeaders(res);

    if (!applyCorsHeaders(req, res)) {
      return;
    }

    if (method === 'OPTIONS') {
      setJsonResponse(res, 204, {});
      return;
    }

    if (!enforceInternalOnlyPolicy(req, pathName, res)) {
      return;
    }

    if (!authorizeRequest(req, pathName, res)) {
      return;
    }

    if (!enforceRateLimit(req, pathName, res)) {
      return;
    }

    if (pathName === '/recipes/register' && method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const payload = await registerOrActivateRecipe(body);
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
        const payload = await updateRecipeStatus(body);
        setJsonResponse(res, 200, payload);
      } catch (error: unknown) {
        setJsonResponse(res, 400, {
          success: false,
          error: getErrorMessage(error),
        });
      }
      return;
    }

    if (pathName === '/recipes/dca/allowance-precheck' && method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const payload = await precheckDcaAllowance(body);
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
        const payload = await listExecutionLogs({
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

    if (pathName === '/recipes' && method === 'GET') {
      try {
        const payload = await listActiveRecipes({
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

    if (pathName === '/recipes/session-quota' && method === 'GET') {
      try {
        const payload = await getSessionSpendQuota({
          userAddress: requestUrl.searchParams.get('userAddress') || undefined,
          sessionKeyAddress: requestUrl.searchParams.get('sessionKeyAddress') || undefined,
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
      await checkDbHealth();
      setJsonResponse(res, 200, {
        status: 'ok',
        service: 'keeper',
        chainId: ARC_TESTNET_CONFIG.chainId,
        keeperAddress,
        contracts: {
          sessionKeyRegistry: CONTRACT_ADDRESSES.sessionKeyRegistry,
          sharedExecutorProxy: CONTRACT_ADDRESSES.sharedExecutorProxy,
          recipeGuardrail: CONTRACT_ADDRESSES.recipeGuardrail,
        },
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
    if (RUNTIME_CONFIG.keeperApiRequireAuth) {
      console.log('[Health] Keeper API auth is enabled for protected endpoints.');
    } else {
      console.warn('[Health Warning] Keeper API auth is disabled. Do not use this mode in production.');
    }
    console.log(
      `[Health] Keeper CORS allowlist contains ${RUNTIME_CONFIG.keeperCorsAllowedOrigins.length} origin(s).`
    );
    if (RUNTIME_CONFIG.keeperInternalOnlyEnforced) {
      console.log(
        `[Health] Internal-only policy enforced for: ${RUNTIME_CONFIG.keeperInternalOnlyPaths.join(', ')}`
      );
    }
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
  console.log(`[Config] Queue Mode             : ${RUNTIME_CONFIG.keeperUseRedisQueue ? 'REDIS_BULLMQ' : 'DIRECT_NO_REDIS'}`);
  console.log(`[Config] Shared Executor Proxy   : ${CONTRACT_ADDRESSES.sharedExecutorProxy}`);
  console.log(`[Config] Recipe Guardrail       : ${CONTRACT_ADDRESSES.recipeGuardrail}`);
  console.log(`[Config] Session Key Registry   : ${CONTRACT_ADDRESSES.sessionKeyRegistry}`);

  // Test database connectivity
  try {
    await connectDb();
    const activeRecipesCount = await countActiveRecipes();
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
    await disconnectDb();
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
    await disconnectDb();
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
