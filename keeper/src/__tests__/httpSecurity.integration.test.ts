import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type http from 'node:http';

const registerOrActivateRecipeMock = vi.fn(async () => ({ success: true }));
const updateRecipeStatusMock = vi.fn(async () => ({ success: true }));
const precheckDcaAllowanceMock = vi.fn(async () => ({ success: true }));
const listExecutionLogsMock = vi.fn(async () => ({ success: true, logs: [] }));
const checkDbHealthMock = vi.fn(async () => undefined);

const runtimeConfig = {
  arcRpcUrl: 'https://rpc.testnet.arc.network/',
  arcRpcFallbackUrls: ['https://rpc.testnet.arc.io/'],
  arcRpcTimeoutMs: 15_000,
  arcRpcRetryCount: 2,
  schedulerSimulationBackoffMs: 30_000,
  simulationEstimateGas: false,
  keeperHealthPort: 8787,
  keeperTxRetryMaxAttempts: 7,
  keeperTxReceiptTimeoutMs: 10_000,
  keeperTxConfirmMaxAttempts: 8,
  keeperTxConfirmRetryDelayMs: 4_000,
  keeperSyncConfirmationInHotPath: false,
  enableUnifiedBalance: false,
  enableGatewayForwarder: false,
  circleClientKey: '',
  circleClientUrl: '',
  gatewayApiBaseUrl: 'https://gateway-api-testnet.circle.com/',
  gatewayTransferPath: '/v1/transfers',
  redisUrl: 'redis://localhost:6379',
  redisRetryMaxDelayMs: 10_000,
  allowAppKitDcaGuardrailBypass: false,
  keeperApiRequireAuth: true,
  keeperApiAuthToken: 'test-token',
  keeperApiRateLimitWindowMs: 60_000,
  keeperApiRateLimitMaxRequests: 100,
  keeperCorsAllowedOrigins: ['http://localhost:3000'],
  keeperInternalOnlyEnforced: true,
  keeperInternalOnlyPaths: ['/healthz', '/metrics'],
};

vi.mock('../config/runtime', () => ({
  RUNTIME_CONFIG: runtimeConfig,
  getKeeperPrivateKey: () => `0x${'1'.repeat(64)}`,
}));

vi.mock('../config/contracts', () => ({
  ARC_TESTNET_CONFIG: {
    chainId: 50_420_02,
    rpcUrl: 'https://rpc.testnet.arc.network/',
  },
  CONTRACT_ADDRESSES: {
    sessionKeyRegistry: '0x1111111111111111111111111111111111111111',
    sharedExecutorProxy: '0x2222222222222222222222222222222222222222',
    recipeGuardrail: '0x3333333333333333333333333333333333333333',
  },
}));

vi.mock('../schedulers/queueScheduler', () => ({
  recipeQueue: { close: vi.fn() },
  recipeWorker: { close: vi.fn() },
  txConfirmationQueue: { close: vi.fn() },
  txConfirmationWorker: { close: vi.fn() },
  executeRecipeStepDirectly: vi.fn(),
}));

vi.mock('../schedulers/cronScheduler', () => ({
  startCronScheduler: vi.fn(),
  stopCronScheduler: vi.fn(),
}));

vi.mock('../api/recipeSyncApi', () => ({
  registerOrActivateRecipe: registerOrActivateRecipeMock,
  updateRecipeStatus: updateRecipeStatusMock,
  precheckDcaAllowance: precheckDcaAllowanceMock,
  listExecutionLogs: listExecutionLogsMock,
}));

vi.mock('../observability/metrics', () => ({
  getKeeperMetricsSnapshot: () => ({
    queueDepth: 0,
    errorRate: 0,
  }),
}));

vi.mock('../db/client', () => ({
  checkDbHealth: checkDbHealthMock,
  connectDb: vi.fn(async () => undefined),
  countActiveRecipes: vi.fn(async () => 0),
  disconnectDb: vi.fn(async () => undefined),
}));

describe('Keeper HTTP security integration', () => {
  let server: http.Server | null = null;
  let baseUrl = '';

  beforeEach(async () => {
    vi.resetModules();
    registerOrActivateRecipeMock.mockClear();
    updateRecipeStatusMock.mockClear();
    precheckDcaAllowanceMock.mockClear();
    listExecutionLogsMock.mockClear();
    checkDbHealthMock.mockClear();

    runtimeConfig.keeperApiRequireAuth = true;
    runtimeConfig.keeperApiAuthToken = 'test-token';
    runtimeConfig.keeperApiRateLimitWindowMs = 60_000;
    runtimeConfig.keeperApiRateLimitMaxRequests = 100;
    runtimeConfig.keeperCorsAllowedOrigins = ['http://localhost:3000'];
    runtimeConfig.keeperInternalOnlyEnforced = true;
    runtimeConfig.keeperInternalOnlyPaths = ['/healthz', '/metrics'];

    const indexModule = await import('../index');
    server = indexModule.createHealthServer(0);

    await new Promise<void>((resolve) => {
      server?.once('listening', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to read server address.');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => {
        server?.close(() => resolve());
      });
    }
    server = null;
    baseUrl = '';
  });

  it('blocks disallowed CORS origin on protected endpoint', async () => {
    const response = await fetch(`${baseUrl}/metrics`, {
      method: 'GET',
      headers: {
        Origin: 'https://evil.example',
        Authorization: 'Bearer test-token',
      },
    });

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toContain('Origin is not allowed');
  });

  it('requires bearer auth on protected endpoint', async () => {
    const response = await fetch(`${baseUrl}/recipes/logs?limit=5`, {
      method: 'GET',
      headers: {
        Origin: 'http://localhost:3000',
      },
    });

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe('Unauthorized.');
  });

  it('enforces per-ip rate limit on protected endpoint', async () => {
    runtimeConfig.keeperApiRateLimitMaxRequests = 2;
    runtimeConfig.keeperApiRateLimitWindowMs = 60_000;

    const first = await fetch(`${baseUrl}/recipes/logs?limit=1`, {
      method: 'GET',
      headers: {
        Origin: 'http://localhost:3000',
        Authorization: 'Bearer test-token',
      },
    });
    const second = await fetch(`${baseUrl}/recipes/logs?limit=1`, {
      method: 'GET',
      headers: {
        Origin: 'http://localhost:3000',
        Authorization: 'Bearer test-token',
      },
    });
    const third = await fetch(`${baseUrl}/recipes/logs?limit=1`, {
      method: 'GET',
      headers: {
        Origin: 'http://localhost:3000',
        Authorization: 'Bearer test-token',
      },
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(third.headers.get('retry-after')).toBeTruthy();
  });

  it('rejects health endpoint from external forwarded address when internal-only is enforced', async () => {
    const response = await fetch(`${baseUrl}/healthz`, {
      method: 'GET',
      headers: {
        'x-forwarded-for': '8.8.8.8',
      },
    });

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toContain('restricted to internal network');
  });

  it('allows health endpoint from internal address', async () => {
    const response = await fetch(`${baseUrl}/healthz`, {
      method: 'GET',
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { status?: string };
    expect(body.status).toBe('ok');
  });
});
