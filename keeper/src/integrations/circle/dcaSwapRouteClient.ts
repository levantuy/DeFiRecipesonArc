import { ARC_CIRBTC_ADDRESS, ARC_EURC_ADDRESS, ARC_USDC_ADDRESS } from '../../config/dcaRouting';

interface DcaSwapRouteRequest {
  recipientAddress: `0x${string}`;
  amountInBaseUnits: bigint;
  maxSlippageBps: number;
  targetAssetSymbol: string;
}

export interface DcaSwapExecutionPlan {
  targetProtocolAddress: `0x${string}`;
  callData: `0x${string}`;
  minSwapAssetOutBaseUnits: bigint;
  spenderAddress?: `0x${string}`;
}

export interface DcaSwapRouteClient {
  resolveRoute(request: DcaSwapRouteRequest): Promise<DcaSwapExecutionPlan>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeHexAddress(value: unknown): `0x${string}` | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
    return null;
  }

  return normalized.toLowerCase() as `0x${string}`;
}

function normalizeHexData(value: unknown): `0x${string}` | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!/^0x[a-fA-F0-9]+$/.test(normalized) || normalized.length < 10) {
    return null;
  }

  return normalized as `0x${string}`;
}

function tryExtractTransaction(record: Record<string, unknown>): { to: `0x${string}`; data: `0x${string}` } | null {
  const to = normalizeHexAddress(record.to ?? record.target ?? record.contractAddress);
  const data = normalizeHexData(record.data ?? record.callData ?? record.input);

  if (to && data) {
    return { to, data };
  }

  return null;
}

function extractTransactionFromResponse(payload: unknown): { to: `0x${string}`; data: `0x${string}` } | null {
  const queue: unknown[] = [payload];
  let scanned = 0;

  while (queue.length > 0 && scanned < 100) {
    scanned += 1;
    const current = queue.shift();

    if (!isRecord(current)) {
      continue;
    }

    const direct = tryExtractTransaction(current);
    if (direct) {
      return direct;
    }

    const transactions = current.transactions;
    if (Array.isArray(transactions)) {
      for (const entry of transactions) {
        if (isRecord(entry)) {
          const candidate = tryExtractTransaction(entry);
          if (candidate) {
            return candidate;
          }
        }
      }
    }

    for (const value of Object.values(current)) {
      if (isRecord(value) || Array.isArray(value)) {
        queue.push(value);
      }
    }
  }

  return null;
}

function parseBigIntFromUnknown(value: unknown): bigint | null {
  if (typeof value === 'bigint') {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0) {
    return BigInt(value);
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    if (/^\d+$/.test(normalized)) {
      return BigInt(normalized);
    }
  }

  return null;
}

function extractMinOutFromResponse(payload: unknown): bigint | null {
  if (!isRecord(payload)) {
    return null;
  }

  const paths: unknown[] = [
    payload.minAmountOut,
    payload.amountOutMin,
    payload.minimumAmountOut,
    isRecord(payload.transaction) && isRecord(payload.transaction.executionParams) && Array.isArray(payload.transaction.executionParams.instructions)
      ? (payload.transaction.executionParams.instructions[0] as Record<string, unknown> | undefined)?.minTokenOut
      : undefined,
    payload.stopLimit,
    isRecord(payload.quote) ? payload.quote.minAmountOut : undefined,
    isRecord(payload.quote) ? payload.quote.minAmount : undefined,
    isRecord(payload.quote) ? payload.quote.amountOutMin : undefined,
    isRecord(payload.route) ? payload.route.minAmountOut : undefined,
    isRecord(payload.route) ? payload.route.amountOutMin : undefined,
  ];

  for (const candidate of paths) {
    const parsed = parseBigIntFromUnknown(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function extractSpenderAddressFromResponse(payload: unknown): `0x${string}` | null {
  if (!isRecord(payload)) {
    return null;
  }

  const directCandidates: unknown[] = [
    payload.spender,
    payload.spenderAddress,
    payload.allowanceTarget,
    payload.approvalAddress,
    payload.tokenTransferProxy,
    isRecord(payload.quote) ? payload.quote.spender : undefined,
    isRecord(payload.quote) ? payload.quote.allowanceTarget : undefined,
    isRecord(payload.route) ? payload.route.spender : undefined,
    isRecord(payload.route) ? payload.route.allowanceTarget : undefined,
    isRecord(payload.transaction) ? payload.transaction.spender : undefined,
    isRecord(payload.transaction) ? payload.transaction.allowanceTarget : undefined,
  ];

  for (const candidate of directCandidates) {
    const normalized = normalizeHexAddress(candidate);
    if (normalized) {
      return normalized;
    }
  }

  const queue: unknown[] = [payload];
  let scanned = 0;

  while (queue.length > 0 && scanned < 100) {
    scanned += 1;
    const current = queue.shift();
    if (!isRecord(current)) {
      continue;
    }

    for (const [key, value] of Object.entries(current)) {
      const normalized = normalizeHexAddress(value);
      if (normalized && /(spender|allowance|approval|proxy)/i.test(key)) {
        return normalized;
      }

      if (isRecord(value) || Array.isArray(value)) {
        queue.push(value);
      }
    }
  }

  return null;
}

function fallbackMinOutFromInput(amountInBaseUnits: bigint, maxSlippageBps: number): bigint {
  return (amountInBaseUnits * BigInt(10_000 - maxSlippageBps)) / 10_000n;
}

class AppKitDcaSwapRouteClient implements DcaSwapRouteClient {
  private getTokenOutAddress(targetAssetSymbol: string): `0x${string}` {
    if (targetAssetSymbol === 'EURC') {
      return ARC_EURC_ADDRESS;
    }

    if (targetAssetSymbol === 'cirBTC') {
      return ARC_CIRBTC_ADDRESS;
    }

    throw new Error(`Unsupported targetAssetSymbol=${targetAssetSymbol} for Arc Testnet DCA.`);
  }

  private async createSwapRouteViaService(request: DcaSwapRouteRequest): Promise<unknown> {
    const baseUrl = process.env.ARC_APP_KIT_SWAP_BASE_URL?.trim() || 'https://api.circle.com';
    const endpoint = new URL('/v1/stablecoinKits/swap', baseUrl).toString();
    const kitKey = process.env.ARC_APP_KIT_KEY?.trim();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (kitKey) {
      headers.Authorization = `Bearer ${kitKey}`;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tokenInAddress: ARC_USDC_ADDRESS,
        tokenInChain: 'Arc_Testnet',
        tokenOutAddress: this.getTokenOutAddress(request.targetAssetSymbol),
        tokenOutChain: 'Arc_Testnet',
        fromAddress: request.recipientAddress,
        toAddress: request.recipientAddress,
        amount: request.amountInBaseUnits.toString(),
        slippageBps: request.maxSlippageBps,
      }),
    });

    const rawBody = await response.text();
    if (!response.ok) {
      const detail = rawBody.length > 0 ? rawBody : `${response.status} ${response.statusText}`;
      throw new Error(`Arc App Kit swap service request failed: ${detail}`);
    }

    if (rawBody.length === 0) {
      throw new Error('Arc App Kit swap service returned an empty response body.');
    }

    try {
      return JSON.parse(rawBody) as unknown;
    } catch {
      throw new Error('Arc App Kit swap service returned non-JSON payload.');
    }
  }

  async resolveRoute(request: DcaSwapRouteRequest): Promise<DcaSwapExecutionPlan> {
    const response = await this.createSwapRouteViaService(request);

    const transaction = extractTransactionFromResponse(response);
    if (!transaction) {
      throw new Error('App Kit swap response did not include executable on-chain transaction data (to/data).');
    }

    const minSwapAssetOutBaseUnits =
      extractMinOutFromResponse(response) ??
      fallbackMinOutFromInput(request.amountInBaseUnits, request.maxSlippageBps);
    const spenderAddress = extractSpenderAddressFromResponse(response) ?? undefined;

    return {
      targetProtocolAddress: transaction.to,
      callData: transaction.data,
      minSwapAssetOutBaseUnits,
      spenderAddress,
    };
  }
}

export function createDcaSwapRouteClientFromRuntime(): DcaSwapRouteClient {
  return new AppKitDcaSwapRouteClient();
}
