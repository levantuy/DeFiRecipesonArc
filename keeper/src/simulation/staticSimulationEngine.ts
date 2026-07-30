import { createPublicClient, http, fallback, Address, Hex } from 'viem';
import { arcTestnet } from 'viem/chains';
import { ARC_TESTNET_CONFIG, CONTRACT_ADDRESSES, SHARED_EXECUTOR_PROXY_ABI } from '../config/contracts';
import { RUNTIME_CONFIG } from '../config/runtime';

// Public Viem client configured for Arc Testnet
function buildArcRpcFallbackTransport() {
  const urls = [RUNTIME_CONFIG.arcRpcUrl, ...RUNTIME_CONFIG.arcRpcFallbackUrls]
    .map((url) => url.trim())
    .filter((url) => url.length > 0);

  const uniqueUrls = Array.from(new Set(urls));
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
    rank: false,
    retryCount: RUNTIME_CONFIG.arcRpcRetryCount,
  });
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
export async function simulateRecipeStep(req: SimulationRequest): Promise<SimulationResult> {
  const proxyAddress = req.executorProxyAddress || CONTRACT_ADDRESSES.sharedExecutorProxy;
  try {
    await publicClient.simulateContract({
      address: proxyAddress,
      abi: SHARED_EXECUTOR_ABI,
      functionName: 'executeRecipeStep',
      args: [req.userAddress, req.targetProtocolAddress, req.callData, req.minAmountOut],
      account: req.keeperAddress,
    });

    const gasEstimate = await publicClient.estimateContractGas({
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
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Simulation reverted without message';
    return {
      success: false,
      errorMessage,
    };
  }
}
