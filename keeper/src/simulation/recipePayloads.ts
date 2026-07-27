import { encodeFunctionData, parseAbi, Address, Hex } from 'viem';

// Standard ABI function definitions for Arc DeFi protocols
const LENDING_ABI = parseAbi([
  'function deposit(uint256 amount)',
  'function withdraw(uint256 amount)',
  'function withdrawForUser(address user, uint256 amount)',
  'function claimRewards()',
]);

const DEX_ROUTER_ABI = parseAbi([
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) returns (uint256[] memory amounts)',
]);

/**
 * Builds function callData for Recipe 1 - USDC Yield Auto-Compounder (Claim & Re-deposit).
 */
export function buildAutoCompounderCallData(userAddress: Address): Hex {
  return encodeFunctionData({
    abi: LENDING_ABI,
    functionName: 'claimRewards',
    args: [],
  });
}

/**
 * Builds function callData for Recipe 2 - USDC Recurring DCA (Swap USDC to Target Asset).
 */
export function buildDcaCallData(
  usdcAmount: bigint,
  minAmountOut: bigint,
  usdcToken: Address,
  targetAsset: Address,
  recipient: Address
): Hex {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200); // 20 mins deadline
  return encodeFunctionData({
    abi: DEX_ROUTER_ABI,
    functionName: 'swapExactTokensForTokens',
    args: [usdcAmount, minAmountOut, [usdcToken, targetAsset], recipient, deadline],
  });
}

/**
 * Builds function callData for Recipe 3 - USDC Smart Yield Rebalancer (Withdraw from Low Yield Protocol).
 */
export function buildRebalancerCallData(userAddress: Address, usdcAmount: bigint): Hex {
  return encodeFunctionData({
    abi: LENDING_ABI,
    functionName: 'withdrawForUser',
    args: [userAddress, usdcAmount],
  });
}
