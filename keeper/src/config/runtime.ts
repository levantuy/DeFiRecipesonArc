const DEFAULT_ARC_RPC_URL = 'https://rpc.testnet.arc.network';
const DEFAULT_ARC_RPC_FALLBACK_URLS = ['https://rpc.testnet.arc.io'];

export interface RuntimeConfig {
  arcRpcUrl: string;
  arcRpcFallbackUrls: string[];
  arcRpcTimeoutMs: number;
  arcRpcRetryCount: number;
  schedulerSimulationBackoffMs: number;
  simulationEstimateGas: boolean;
  keeperHealthPort: number;
  keeperTxRetryMaxAttempts: number;
  keeperTxReceiptTimeoutMs: number;
  keeperTxConfirmMaxAttempts: number;
  keeperTxConfirmRetryDelayMs: number;
  keeperSyncConfirmationInHotPath: boolean;
  enableUnifiedBalance: boolean;
  enableGatewayForwarder: boolean;
  circleClientKey: string;
  circleClientUrl: string;
  gatewayApiBaseUrl: string;
  gatewayTransferPath: string;
  redisUrl: string;
  redisRetryMaxDelayMs: number;
}

function parseBooleanEnv(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  throw new Error(`[Config Error] ${key} must be a boolean value (true/false). Received: ${raw}`);
}

function parseIntegerEnv(
  key: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const raw = process.env[key];
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `[Config Error] ${key} must be an integer between ${minimum} and ${maximum}. Received: ${raw}`
    );
  }

  return value;
}

function parseUrlEnv(key: string, fallback: string): string {
  const raw = process.env[key] || fallback;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Unsupported URL protocol');
    }
    return parsed.toString();
  } catch {
    throw new Error(`[Config Error] ${key} must be a valid HTTP/HTTPS URL. Received: ${raw}`);
  }
}

function parseUrlListEnv(key: string, fallback: string[]): string[] {
  const raw = process.env[key];
  const candidates = raw
    ? raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
    : fallback;

  const normalized = candidates.map((value) => parseUrlEnv(key, value));
  return Array.from(new Set(normalized));
}

export function isValidPrivateKey(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

export function getKeeperPrivateKey(): `0x${string}` {
  const raw = process.env.KEEPER_PRIVATE_KEY;
  if (!raw || !isValidPrivateKey(raw)) {
    throw new Error(
      '[Config Error] KEEPER_PRIVATE_KEY is missing or invalid. Expected a 32-byte hex string prefixed with 0x.'
    );
  }
  return raw;
}

export const RUNTIME_CONFIG: RuntimeConfig = {
  arcRpcUrl: parseUrlEnv('ARC_TESTNET_RPC_URL', DEFAULT_ARC_RPC_URL),
  arcRpcFallbackUrls: parseUrlListEnv('ARC_TESTNET_RPC_FALLBACK_URLS', DEFAULT_ARC_RPC_FALLBACK_URLS),
  arcRpcTimeoutMs: parseIntegerEnv('ARC_RPC_TIMEOUT_MS', 15_000, 1_000, 120_000),
  arcRpcRetryCount: parseIntegerEnv('ARC_RPC_RETRY_COUNT', 2, 0, 10),
  schedulerSimulationBackoffMs: parseIntegerEnv('SCHEDULER_SIMULATION_BACKOFF_MS', 30_000, 5_000, 300_000),
  simulationEstimateGas: parseBooleanEnv('KEEPER_SIMULATION_ESTIMATE_GAS', false),
  keeperHealthPort: parseIntegerEnv('KEEPER_HEALTH_PORT', 8787, 1, 65535),
  keeperTxRetryMaxAttempts: parseIntegerEnv('KEEPER_TX_RETRY_MAX_ATTEMPTS', 7, 1, 10),
  keeperTxReceiptTimeoutMs: parseIntegerEnv('KEEPER_TX_RECEIPT_TIMEOUT_MS', 10_000, 1_000, 300_000),
  keeperTxConfirmMaxAttempts: parseIntegerEnv('KEEPER_TX_CONFIRM_MAX_ATTEMPTS', 8, 1, 20),
  keeperTxConfirmRetryDelayMs: parseIntegerEnv('KEEPER_TX_CONFIRM_RETRY_DELAY_MS', 4_000, 500, 60_000),
  keeperSyncConfirmationInHotPath: parseBooleanEnv('KEEPER_SYNC_CONFIRMATION_IN_HOT_PATH', false),
  enableUnifiedBalance: parseBooleanEnv('ENABLE_UNIFIED_BALANCE', false),
  enableGatewayForwarder: parseBooleanEnv('ENABLE_GATEWAY_FORWARDER', false),
  circleClientKey: process.env.CIRCLE_CLIENT_KEY || '',
  circleClientUrl: process.env.CIRCLE_CLIENT_URL || '',
  gatewayApiBaseUrl: parseUrlEnv('GATEWAY_API_BASE_URL', 'https://gateway-api-testnet.circle.com/'),
  gatewayTransferPath: process.env.GATEWAY_TRANSFER_PATH || '/v1/transfers',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  redisRetryMaxDelayMs: parseIntegerEnv('REDIS_RETRY_MAX_DELAY_MS', 10_000, 250, 120_000),
};