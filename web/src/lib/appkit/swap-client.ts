'use client';

import { AppKit, SwapChain } from '@circle-fin/app-kit';
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2';
import type { EIP1193Provider } from 'viem';

export type FxToken = 'USDC' | 'EURC';

export type QuoteResult = {
  amountOut: string;
  effectiveRate: string;
};

export type ExecuteResult = {
  amountOut?: string;
  txHash?: string;
};

let cachedKit: AppKit | null = null;

function kit() {
  if (!cachedKit) {
    cachedKit = new AppKit();
  }
  return cachedKit;
}

function chain(): SwapChain {
  const value = (process.env.NEXT_PUBLIC_ARC_CHAIN ?? 'Arc_Testnet') as keyof typeof SwapChain;
  const resolved = SwapChain[value];

  if (!resolved) {
    throw new Error(`NEXT_PUBLIC_ARC_CHAIN must be a valid SwapChain identifier (got "${process.env.NEXT_PUBLIC_ARC_CHAIN ?? 'Arc_Testnet'}").`);
  }

  return resolved;
}

async function getAdapter() {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('Connect a browser wallet (for example MetaMask) to swap.');
  }

  return createViemAdapterFromProvider({ provider: window.ethereum as EIP1193Provider });
}

export async function estimateSwap({ tokenIn, tokenOut, amountIn }: { tokenIn: FxToken; tokenOut: FxToken; amountIn: string }): Promise<QuoteResult> {
  const adapter = await getAdapter();
  const result = await kit().estimateSwap({
    from: { adapter, chain: chain() },
    tokenIn,
    tokenOut,
    amountIn,
  });

  const amountOut = result.estimatedOutput.amount;
  const inNum = Number(amountIn);
  const outNum = Number(amountOut);
  const effectiveRate = inNum > 0 ? (outNum / inNum).toString() : '0';

  return { amountOut, effectiveRate };
}

export async function executeSwap({
  tokenIn,
  tokenOut,
  amountIn,
  slippageBps,
  stopLimit,
  appFeeBps,
  appFeeRecipient,
}: {
  tokenIn: FxToken;
  tokenOut: FxToken;
  amountIn: string;
  slippageBps: number;
  stopLimit?: string;
  appFeeBps: number;
  appFeeRecipient: string;
}): Promise<ExecuteResult> {
  const adapter = await getAdapter();
  const result = await kit().swap({
    from: { adapter, chain: chain() },
    tokenIn,
    tokenOut,
    amountIn,
    config: {
      slippageBps,
      ...(stopLimit ? { stopLimit } : {}),
      ...(appFeeRecipient
        ? {
            customFee: {
              percentageBps: appFeeBps,
              recipientAddress: appFeeRecipient,
            },
          }
        : {}),
    },
  });

  return {
    amountOut: result.amountOut,
    txHash: result.txHash,
  };
}
