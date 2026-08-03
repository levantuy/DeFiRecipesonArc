const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export const ARC_USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const;
export const ARC_EURC_ADDRESS = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' as const;
export const ARC_CIRBTC_ADDRESS = '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF' as const;
export const ARC_APP_KIT_DCA_USDC_SPENDER = '0xf992efcb5fa2ed7cb48310d9dd8cb4ce5fb7ddc9' as const;

export const ARC_TESTNET_SUPPORTED_TOKENS = ['USDC', 'EURC', 'cirBTC'] as const;
export type ArcTestnetTokenSymbol = (typeof ARC_TESTNET_SUPPORTED_TOKENS)[number];

const ARC_TESTNET_TOKEN_BY_NORMALIZED_SYMBOL: Record<string, ArcTestnetTokenSymbol> = {
  usdc: 'USDC',
  eurc: 'EURC',
  cirbtc: 'cirBTC',
};

export const DEFAULT_DCA_TARGET_ASSET_SYMBOL: ArcTestnetTokenSymbol = 'EURC';

export const DEFAULT_DCA_MAX_SLIPPAGE_BPS = 100;
export const MIN_DCA_SLIPPAGE_BPS = 10;
export const MAX_DCA_SLIPPAGE_BPS = 1000;

export function normalizeAddressOrNull(value: unknown): `0x${string}` | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!ADDRESS_REGEX.test(normalized)) {
    return null;
  }

  return normalized.toLowerCase() as `0x${string}`;
}

export function parseDcaMaxSlippageBpsStrict(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error('maxSlippageBps must be an integer.');
  }

  if (value < MIN_DCA_SLIPPAGE_BPS || value > MAX_DCA_SLIPPAGE_BPS) {
    throw new Error(
      `maxSlippageBps must be between ${MIN_DCA_SLIPPAGE_BPS} and ${MAX_DCA_SLIPPAGE_BPS}.`
    );
  }

  return value;
}

export function parseDcaMaxSlippageBpsWithFallback(value: unknown): {
  maxSlippageBps: number;
  usedFallback: boolean;
} {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return { maxSlippageBps: DEFAULT_DCA_MAX_SLIPPAGE_BPS, usedFallback: true };
  }

  if (value < MIN_DCA_SLIPPAGE_BPS || value > MAX_DCA_SLIPPAGE_BPS) {
    return { maxSlippageBps: DEFAULT_DCA_MAX_SLIPPAGE_BPS, usedFallback: true };
  }

  return { maxSlippageBps: value, usedFallback: false };
}

function normalizeSupportedArcTokenSymbol(value: unknown): ArcTestnetTokenSymbol | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return ARC_TESTNET_TOKEN_BY_NORMALIZED_SYMBOL[normalized] ?? null;
}

export function parseDcaTargetAssetSymbolStrict(value: unknown): ArcTestnetTokenSymbol {
  const normalized = normalizeSupportedArcTokenSymbol(value);
  if (!normalized) {
    throw new Error(
      `targetAssetSymbol must be one of: ${ARC_TESTNET_SUPPORTED_TOKENS.join(', ')}.`
    );
  }

  return normalized;
}

export function parseDcaTargetAssetSymbolWithFallback(value: unknown): {
  targetAssetSymbol: ArcTestnetTokenSymbol;
  usedFallback: boolean;
} {
  const normalized = normalizeSupportedArcTokenSymbol(value);
  if (!normalized) {
    return {
      targetAssetSymbol: DEFAULT_DCA_TARGET_ASSET_SYMBOL,
      usedFallback: true,
    };
  }

  return {
    targetAssetSymbol: normalized,
    usedFallback: false,
  };
}
