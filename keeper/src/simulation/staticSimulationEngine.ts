import { createPublicClient, http, Address, Hex } from 'viem';
import { arcTestnet } from 'viem/chains';
import { ARC_TESTNET_CONFIG, CONTRACT_ADDRESSES, SHARED_EXECUTOR_PROXY_ABI } from '../config/contracts';

// Public Viem client configured for Arc Testnet
export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_TESTNET_CONFIG.rpcUrl),
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
    const { result, request } = await publicClient.simulateContract({
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
  } catch (err: any) {
    return {
      success: false,
      errorMessage: err.message || 'Simulation reverted without message',
    };
  }
}
