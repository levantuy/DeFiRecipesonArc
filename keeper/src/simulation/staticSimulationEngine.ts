import { createPublicClient, http, Address, Hex, parseAbi } from 'viem';
import { arcTestnet } from 'viem/chains';

// Public Viem client configured for Arc Testnet
export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http('https://rpc.testnet.arc.network'),
});

export interface SimulationRequest {
  userAddress: Address;
  executorProxyAddress: Address;
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

const SHARED_EXECUTOR_ABI = parseAbi([
  'function executeRecipeStep(address user, address targetProtocol, bytes callData, uint256 minAmountOut) external',
]);

/**
 * Pre-flight Static Simulation Engine using eth_call via Viem v2.
 * Runs transaction simulation off-chain BEFORE broadcasting to Arc RPC to avoid failed transactions & gas waste.
 */
export async function simulateRecipeStep(req: SimulationRequest): Promise<SimulationResult> {
  try {
    const { result, request } = await publicClient.simulateContract({
      address: req.executorProxyAddress,
      abi: SHARED_EXECUTOR_ABI,
      functionName: 'executeRecipeStep',
      args: [req.userAddress, req.targetProtocolAddress, req.callData, req.minAmountOut],
      account: req.keeperAddress,
    });

    const gasEstimate = await publicClient.estimateContractGas({
      address: req.executorProxyAddress,
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
