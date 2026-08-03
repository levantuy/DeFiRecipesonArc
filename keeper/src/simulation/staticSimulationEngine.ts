import { createPublicClient, http, fallback, Address, Hex } from 'viem';
import { arcTestnet } from 'viem/chains';
import { ARC_TESTNET_CONFIG, CONTRACT_ADDRESSES, SHARED_EXECUTOR_PROXY_ABI } from '../config/contracts';
import { RUNTIME_CONFIG } from '../config/runtime';
import { incrementCounter } from '../observability/metrics';

const dedicatedPublicClientCache = new Map<string, ReturnType<typeof createPublicClient>>();

function getArcRpcUrls(): string[] {
  const urls = [RUNTIME_CONFIG.arcRpcUrl, ...RUNTIME_CONFIG.arcRpcFallbackUrls]
    .map((url) => url.trim())
    .filter((url) => url.length > 0);

  return Array.from(new Set(urls));
}

// Public Viem client configured for Arc Testnet
function buildArcRpcFallbackTransport() {
  const uniqueUrls = getArcRpcUrls();
  const transports = uniqueUrls.map((url) =>
    http(url, {
      timeout: RUNTIME_CONFIG.arcRpcTimeoutMs,
      retryCount: RUNTIME_CONFIG.arcRpcRetryCount,
    })
  );

  if (transports.length === 1) {
    return transports[0];
  }

  return fallback(transports, {
    rank: true,
    retryCount: RUNTIME_CONFIG.arcRpcRetryCount,
  });
}

function getDedicatedPublicClient(rpcUrl: string) {
  const cached = dedicatedPublicClientCache.get(rpcUrl);
  if (cached) {
    return cached;
  }

  const client = createPublicClient({
    chain: arcTestnet,
    transport: http(rpcUrl, {
      timeout: RUNTIME_CONFIG.arcRpcTimeoutMs,
      retryCount: 0,
    }),
  });

  dedicatedPublicClientCache.set(rpcUrl, client);
  return client;
}

function isRateLimitErrorMessage(errorMessage: string): boolean {
  const normalized = errorMessage.toLowerCase();
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

function isRetryableRpcErrorMessage(errorMessage: string): boolean {
  const normalized = errorMessage.toLowerCase();
  return (
    isRateLimitErrorMessage(errorMessage) ||
    normalized.includes('rpc request failed') ||
    normalized.includes('timeout') ||
    normalized.includes('timed out') ||
    normalized.includes('network error') ||
    normalized.includes('socket hang up') ||
    normalized.includes('econnreset') ||
    normalized.includes('503') ||
    normalized.includes('temporarily unavailable')
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function trySimulationWithClient(
  client: ReturnType<typeof createPublicClient>,
  req: SimulationRequest,
  includeGasEstimate: boolean,
  proxyAddress: Address
): Promise<{ success: true; estimatedGasUsdc?: bigint }> {
  incrementCounter('rpc.total');
  await client.simulateContract({
    address: proxyAddress,
    abi: SHARED_EXECUTOR_ABI,
    functionName: 'executeRecipeStep',
    args: [req.userAddress, req.targetProtocolAddress, req.callData, req.minAmountOut],
    account: req.keeperAddress,
  });

  if (!includeGasEstimate) {
    return { success: true };
  }

  incrementCounter('rpc.total');
  const gasEstimate = await client.estimateContractGas({
    address: proxyAddress,
    abi: SHARED_EXECUTOR_ABI,
    functionName: 'executeRecipeStep',
    args: [req.userAddress, req.targetProtocolAddress, req.callData, req.minAmountOut],
    account: req.keeperAddress,
  });

  return {
    success: true,
    estimatedGasUsdc: gasEstimate,
  };
}

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: buildArcRpcFallbackTransport(),
});

export interface SimulationRequest {
  userAddress: Address;
  executorProxyAddress?: Address;
  targetProtocolAddress: Address;
  callData: Hex;
  minAmountOut: bigint;
  keeperAddress: Address;
}

export interface SimulationOptions {
  includeGasEstimate?: boolean;
}

export interface SimulationResult {
  success: boolean;
  estimatedGasUsdc?: bigint;
  errorMessage?: string;
}

const SHARED_EXECUTOR_ABI = SHARED_EXECUTOR_PROXY_ABI;

/**
 * Pre-flight Static Simulation Engine using eth_call via Viem v2.
 * Runs transaction simulation off-chain BEFORE broadcasting to Arc RPC to avoid failed transactions & gas waste.
 */
export async function simulateRecipeStep(
  req: SimulationRequest,
  options: SimulationOptions = {}
): Promise<SimulationResult> {
  incrementCounter('simulation.total');
  const proxyAddress = req.executorProxyAddress || CONTRACT_ADDRESSES.sharedExecutorProxy;
  const includeGasEstimate = options.includeGasEstimate ?? true;

  const errors: string[] = [];
  let rateLimitErrorCount = 0;

  try {
    const primaryResult = await trySimulationWithClient(publicClient, req, includeGasEstimate, proxyAddress);
    return {
      success: true,
      estimatedGasUsdc: primaryResult.estimatedGasUsdc,
    };
  } catch (primaryError: unknown) {
    const errorMessage = toErrorMessage(primaryError);
    errors.push(`[fallback-transport] ${errorMessage}`);

    if (isRateLimitErrorMessage(errorMessage)) {
      incrementCounter('rpc.rateLimited');
      rateLimitErrorCount += 1;
    }

    if (!isRetryableRpcErrorMessage(errorMessage)) {
      return {
        success: false,
        errorMessage,
      };
    }
  }

  const rpcUrls = getArcRpcUrls();
  for (const rpcUrl of rpcUrls) {
    try {
      const dedicatedClient = getDedicatedPublicClient(rpcUrl);
      const result = await trySimulationWithClient(dedicatedClient, req, includeGasEstimate, proxyAddress);
      return {
        success: true,
        estimatedGasUsdc: result.estimatedGasUsdc,
      };
    } catch (error: unknown) {
      const message = toErrorMessage(error);
      errors.push(`[${rpcUrl}] ${message}`);

      if (isRateLimitErrorMessage(message)) {
        incrementCounter('rpc.rateLimited');
        rateLimitErrorCount += 1;
      }

      if (!isRetryableRpcErrorMessage(message)) {
        return {
          success: false,
          errorMessage: message,
        };
      }
    }
  }

  const retriedEndpointCount = rpcUrls.length + 1;
  const exhaustedByRateLimit = rateLimitErrorCount >= retriedEndpointCount;
  const aggregatedMessage = exhaustedByRateLimit
    ? `All Arc RPC endpoints are rate-limited. ${errors.join(' | ')}`
    : `Arc RPC simulation failed across endpoints. ${errors.join(' | ')}`;

  return {
    success: false,
    errorMessage: aggregatedMessage,
  };
}
