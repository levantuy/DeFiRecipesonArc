import { encodeFunctionData } from 'viem';

/**
 * On-chain adapter contract used by Circle App Kit / Swap Kit on EVM chains.
 * The Stablecoin Service returns signed `executionParams`; the caller submits them
 * through this single `execute()` entrypoint instead of replaying inner instructions.
 */
export const ARC_SWAP_ADAPTER_ABI = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'payable',
    outputs: [],
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          {
            name: 'instructions',
            type: 'tuple[]',
            components: [
              { name: 'target', type: 'address' },
              { name: 'data', type: 'bytes' },
              { name: 'value', type: 'uint256' },
              { name: 'tokenIn', type: 'address' },
              { name: 'amountToApprove', type: 'uint256' },
              { name: 'tokenOut', type: 'address' },
              { name: 'minTokenOut', type: 'uint256' },
            ],
          },
          {
            name: 'tokens',
            type: 'tuple[]',
            components: [
              { name: 'token', type: 'address' },
              { name: 'beneficiary', type: 'address' },
            ],
          },
          { name: 'execId', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'metadata', type: 'bytes' },
        ],
      },
      {
        name: 'tokenInputs',
        type: 'tuple[]',
        components: [
          { name: 'permitType', type: 'uint8' },
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'permitCalldata', type: 'bytes' },
        ],
      },
      { name: 'signature', type: 'bytes' },
    ],
  },
] as const;

// IAdapter.PermitType.NONE: the caller pre-approves the adapter instead of signing EIP-2612.
const PERMIT_TYPE_NONE = 0;

export interface AdapterExecutionInstruction {
  target: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
  tokenIn: `0x${string}`;
  amountToApprove: bigint;
  tokenOut: `0x${string}`;
  minTokenOut: bigint;
}

export interface AdapterExecutionParams {
  instructions: AdapterExecutionInstruction[];
  tokens: Array<{ token: `0x${string}`; beneficiary: `0x${string}` }>;
  execId: bigint;
  deadline: bigint;
  metadata: `0x${string}`;
}

export function buildArcSwapAdapterExecuteCallData(params: {
  executionParams: AdapterExecutionParams;
  signature: `0x${string}`;
  tokenInAddress: `0x${string}`;
  amountInBaseUnits: bigint;
}): `0x${string}` {
  return encodeFunctionData({
    abi: ARC_SWAP_ADAPTER_ABI,
    functionName: 'execute',
    args: [
      params.executionParams,
      [
        {
          permitType: PERMIT_TYPE_NONE,
          token: params.tokenInAddress,
          amount: params.amountInBaseUnits,
          permitCalldata: '0x' as `0x${string}`,
        },
      ],
      params.signature,
    ],
  });
}
