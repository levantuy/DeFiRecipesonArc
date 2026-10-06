/**
 * Shared DCA calldata / allowance spender utilities.
 *
 * These functions were previously duplicated verbatim between
 * `cronScheduler.ts` and `recipeSyncApi.ts`. Both files now import
 * from this single source of truth.
 */

import { decodeFunctionData } from 'viem';
import { ARC_APP_KIT_DCA_USDC_SPENDER, ARC_SWAP_ADAPTER_EXECUTE_SELECTOR } from '../config/dcaRouting';
import { CONTRACT_ADDRESSES } from '../config/contracts';

export const DCA_SWAP_SELECTOR = '0x7ebc46f0';

export const DCA_ALWAYS_STRICT_SPENDERS = new Set<string>([
  '0x00000000000000000000000000000000000000c0',
]);

export const DCA_SWAP_ABI = [
  {
    type: 'function',
    name: 'swapExactTokensForTokens',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
] as const;

export function extractSelectorFromCallData(callData: `0x${string}`): `0x${string}` {
  if (callData.length < 10) {
    return '0x';
  }
  return callData.slice(0, 10) as `0x${string}`;
}

export function extractAddressWordFromCalldata(
  callData: `0x${string}`,
  wordIndex: number
): `0x${string}` | null {
  const data = callData.slice(2);
  const start = 8 + wordIndex * 64;
  const end = start + 64;
  if (data.length < end) {
    return null;
  }

  const word = data.slice(start, end);
  const addressHex = `0x${word.slice(24)}`;
  if (!/^0x[a-fA-F0-9]{40}$/.test(addressHex)) {
    return null;
  }

  return addressHex.toLowerCase() as `0x${string}`;
}

export function getDcaDecodedSpenderCandidates(callData: `0x${string}`): `0x${string}`[] {
  const fallbackCandidates = [
    extractAddressWordFromCalldata(callData, 1),
    extractAddressWordFromCalldata(callData, 3),
  ].filter(
    (value): value is `0x${string}` =>
      value !== null &&
      value.toLowerCase() !== '0x0000000000000000000000000000000000000000'
  );

  try {
    const decoded = decodeFunctionData({
      abi: DCA_SWAP_ABI,
      data: callData,
    });

    if (decoded.functionName !== 'swapExactTokensForTokens') {
      return Array.from(
        new Set(fallbackCandidates.map((c) => c.toLowerCase()))
      ) as `0x${string}`[];
    }

    const [, , path, to] = decoded.args as [
      bigint,
      bigint,
      readonly `0x${string}`[],
      `0x${string}`,
      bigint,
    ];
    const abiCandidates = [to, ...(Array.isArray(path) ? path : [])].filter(
      (value): value is `0x${string}` =>
        Boolean(value) &&
        /^0x[a-fA-F0-9]{40}$/.test(value) &&
        value.toLowerCase() !== '0x0000000000000000000000000000000000000000'
    );

    const merged = Array.from(new Set([...abiCandidates, ...fallbackCandidates]));
    return merged.map((c) => c.toLowerCase()) as `0x${string}`[];
  } catch {
    return Array.from(
      new Set(fallbackCandidates.map((c) => c.toLowerCase()))
    ) as `0x${string}`[];
  }
}

export function normalizeDcaSpenderCandidates(candidates: `0x${string}`[]): `0x${string}`[] {
  return Array.from(
    new Set(
      candidates
        .filter((c) => c.toLowerCase() !== '0x0000000000000000000000000000000000000000')
        .map((c) => c.toLowerCase())
    )
  ) as `0x${string}`[];
}

export function resolveDcaAllowanceSpenderAddress(
  callData: `0x${string}`,
  targetProtocol: `0x${string}`,
  routeSpenderAddress: `0x${string}` | null | undefined
): `0x${string}` {
  if (routeSpenderAddress) {
    return routeSpenderAddress;
  }

  if (extractSelectorFromCallData(callData).toLowerCase() === DCA_SWAP_SELECTOR) {
    const decodedSpenders = getDcaDecodedSpenderCandidates(callData);
    if (decodedSpenders.length > 0) {
      return decodedSpenders[0] as `0x${string}`;
    }
  }

  if (targetProtocol && targetProtocol !== ARC_APP_KIT_DCA_USDC_SPENDER) {
    return targetProtocol;
  }

  return ARC_APP_KIT_DCA_USDC_SPENDER;
}

// Arc Testnet router addresses that pull USDC directly from the user inside the
// ArcSwapAdapter execution path. These are not present as top-level ABI-decoded
// addresses in the Circle calldata, so we include them unconditionally when the
// inner calldata selector is ARC_SWAP_ADAPTER_EXECUTE_SELECTOR (0xaa3e079c).
const ARC_ROUTE_STRICT_SPENDERS: `0x${string}`[] = [
  '0xff70f4a1d11995621854f3692acf286d8acd04b2', // LI.FI Fly DEX Router
  '0x311d3f5530245b839dae6cf91685ae64c605e956', // Curve USDC/EURC Pool
];

export function getDcaAllowanceSpenderCandidates(
  callData: `0x${string}`,
  targetProtocol: `0x${string}`,
  routeSpenderAddress: `0x${string}` | null | undefined
): `0x${string}`[] {
  const runtimeSpender = resolveDcaAllowanceSpenderAddress(
    callData,
    targetProtocol,
    routeSpenderAddress
  );
  const decodedSpenders = getDcaDecodedSpenderCandidates(callData);
  const selector = extractSelectorFromCallData(callData).toLowerCase();
  // For ArcSwapAdapter routes, include the Arc-specific router contracts that pull
  // USDC from the user inside the execution path.
  const arcRouteSpenders =
    selector === ARC_SWAP_ADAPTER_EXECUTE_SELECTOR ? ARC_ROUTE_STRICT_SPENDERS : [];
  return normalizeDcaSpenderCandidates([
    runtimeSpender,
    ...decodedSpenders,
    targetProtocol,
    CONTRACT_ADDRESSES.sharedExecutorProxy as `0x${string}`,
    ...arcRouteSpenders,
  ]).sort() as `0x${string}`[];
}

export function getDcaAlwaysStrictDecodedSpenders(
  callData: `0x${string}`,
  userAddress: `0x${string}`
): `0x${string}`[] {
  const normalizedUserAddress = userAddress.toLowerCase();
  return getDcaDecodedSpenderCandidates(callData).filter((candidate) => {
    const normalized = candidate.toLowerCase();
    return normalized !== normalizedUserAddress && DCA_ALWAYS_STRICT_SPENDERS.has(normalized);
  });
}

export function getDcaStrictRequiredSpenders(
  callData: `0x${string}`,
  targetProtocol: `0x${string}`,
  routeSpenderAddress: `0x${string}` | null | undefined,
  userAddress: `0x${string}`
): `0x${string}`[] {
  const selector = extractSelectorFromCallData(callData).toLowerCase();
  const strictDecodedSpenders = getDcaAlwaysStrictDecodedSpenders(callData, userAddress);
  if (selector === DCA_SWAP_SELECTOR || selector === ARC_SWAP_ADAPTER_EXECUTE_SELECTOR) {
    // For ArcSwapAdapter routes, also require allowances to the Arc-specific router
    // contracts that pull USDC from the user inside the inner execution path.
    return normalizeDcaSpenderCandidates([
      CONTRACT_ADDRESSES.sharedExecutorProxy as `0x${string}`,
      ...ARC_ROUTE_STRICT_SPENDERS,
      ...strictDecodedSpenders,
    ]);
  }

  const runtimeSpender = resolveDcaAllowanceSpenderAddress(
    callData,
    targetProtocol,
    routeSpenderAddress
  );
  return normalizeDcaSpenderCandidates([runtimeSpender, ...strictDecodedSpenders]);
}
