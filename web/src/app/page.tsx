'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Navbar } from '@/components/Navbar';
import { RecipeCatalog, RECIPES } from '@/components/RecipeCatalog';
import { DcaAllowancePrecheckResult, SimulationModal, RecipeConfig } from '@/components/SimulationModal';
import { PortfolioTracker } from '@/components/PortfolioTracker';
import {
  ARC_TESTNET_CHAIN_ID,
  CONTRACT_ADDRESSES,
  SESSION_KEY_REGISTRY_ABI,
  SHARED_EXECUTOR_PROXY_ABI,
} from '@/config/contracts';
import {
  DcaExecutionMode,
  estimateDcaRuns,
  parseDcaActivationConfig,
} from '@/lib/dcaConfig';
import { ShieldCheck, Sparkles, Cpu, Pause, Play, Trash2, Loader2, ExternalLink, Activity, Clock3, RotateCcw, CheckCircle2, XCircle } from 'lucide-react';
import { parseUnits } from 'viem';
import { parseUsdcAmountToBaseUnits } from '@/lib/dcaConfig';
import { parseIntervalHours } from '@/lib/intervalConfig';
import type { IntervalPreset, SwapProvider } from '@/components/SimulationModal';
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { useLanguage } from '@/lib/i18n/LanguageProvider';
import { FooterLinkIcon } from './layout-icons';
import { APP_VERSION, footerLinks } from './layout-config';

// Cumulative USDC spend quota shared across every recipe for the same userAddress + keeper session key pair.

const DEFAULT_SESSION_VALIDITY_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_SESSION_SPEND_HEADROOM = parseUnits('10', 6);
const TX_SEND_MAX_RETRIES = 7;
const TX_SEND_BASE_DELAY_MS = 1500;
const TX_RETRY_MAX_DELAY_MS = 12000;
const TX_ACTION_COOLDOWN_MS = 6000;
const TX_CONFIRM_POLL_INTERVAL_MS = 2500;
const TX_CONFIRM_TIMEOUT_MS = 60_000;
const TX_CONFIRM_BACKGROUND_MAX_ROUNDS = 2;
const TX_CONFIRM_BACKGROUND_DELAY_MS = 15_000;

type RecipeLifecycleStatus = 'inactive' | 'active' | 'paused' | 'revoked';
type TxLifecycleStatus = 'idle' | 'submitted' | 'confirmed' | 'timeout' | 'failed' | 'already-valid';

interface ActiveRecipeState {
  id: string;
  recipeType: string;
  targetProtocolAddress?: `0x${string}`;
  status: RecipeLifecycleStatus;
  txLifecycleStatus: TxLifecycleStatus;
  maxSlippageBps: number;
  sessionSpendLimitUsdc: string;
  validUntil: string;
  txHash: `0x${string}` | null;
  checkIntervalHours?: number;
  intervalPreset?: string;
}

interface SessionSpendQuotaSnapshot {
  maxUsdcSpendLimit: string;
  currentUsdcSpent: string;
  remainingUsdcSpendLimit: string;
  validUntil: string | null;
}

interface DelegationSetupResult {
  txHash: `0x${string}` | null;
  alreadyValid: boolean;
}

interface WalletReadyContext {
  connectedAddress: `0x${string}`;
  keeperSessionKeyAddress: `0x${string}`;
  sessionKeyRegistryAddress: `0x${string}`;
}

interface DcaAllowancePrecheckApiResponse {
  success?: boolean;
  allowance?: DcaAllowancePrecheckResult;
  error?: string;
}

interface KeeperRuntimeConfigApiResponse {
  success?: boolean;
  runtime?: {
    keeperAddress?: string | null;
    chainId?: number | null;
    contracts?: Record<string, unknown> | null;
    timestamp?: string | null;
  };
  error?: string;
}

interface SessionSpendQuotaApiResponse {
  success?: boolean;
  quota?: {
    maxUsdcSpendLimit?: string;
    currentUsdcSpent?: string;
    remainingUsdcSpendLimit?: string;
    validUntil?: string | null;
  } | null;
  error?: string;
}

interface PersistedActiveRecipeApiItem {
  id?: string;
  userAddress?: string;
  recipeType?: string;
  status?: string;
  maxSlippageBps?: number;
  sessionSpendLimitUsdc?: string | null;
  maxUsdcSpendLimit?: string | null;
  delegationTxHash?: string | null;
  delegationValidUntil?: string | null;
  createdAt?: string;
  checkIntervalHours?: number;
  intervalPreset?: string;
}

interface PersistedActiveRecipesApiResponse {
  success?: boolean;
  dataSource?: 'keeper-db' | 'memory-fallback';
  recipes?: PersistedActiveRecipeApiItem[];
  error?: string;
}

const ERC20_ALLOWANCE_AND_APPROVE_ABI = [
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address', internalType: 'address' },
      { name: 'spender', type: 'address', internalType: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address', internalType: 'address' },
      { name: 'amount', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
  },
] as const;

function isAddress(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function getErrorMessage(error: unknown): string {
  if (isRateLimitError(error)) {
    return 'Arc RPC request limit reached. Please wait 10-20 seconds and retry. If this keeps happening, switch your wallet RPC endpoint between https://rpc.testnet.arc.io and https://rpc.testnet.arc.network.';
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return 'Unknown error.';
}

function isRateLimitError(error: unknown): boolean {
  const serialized =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === 'string'
        ? error
        : JSON.stringify(error);

  const normalized = serialized.toLowerCase();
  const hasHttp429 =
    /\b429\b/.test(normalized) &&
    (normalized.includes('status code') || normalized.includes('http') || normalized.includes('too many requests'));

  return (
    normalized.includes('request limit reached') ||
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('-32011') ||
    hasHttp429
  );
}

function isPendingReceiptError(error: unknown): boolean {
  const serialized =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === 'string'
        ? error
        : JSON.stringify(error);

  const normalized = serialized.toLowerCase();
  return (
    normalized.includes('transactionreceiptnotfounderror') ||
    normalized.includes('could not find transaction receipt') ||
    normalized.includes('not found')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getRetryDelayMs(attempt: number, baseDelayMs = TX_SEND_BASE_DELAY_MS): number {
  const exponentialDelay = Math.min(baseDelayMs * 2 ** (attempt - 1), TX_RETRY_MAX_DELAY_MS);
  const jitterMs = Math.floor(Math.random() * 500);
  return exponentialDelay + jitterMs;
}

function mapBackendStatusToLifecycleStatus(status: string | undefined): RecipeLifecycleStatus {
  if (status === 'ACTIVE') {
    return 'active';
  }
  if (status === 'PAUSED') {
    return 'paused';
  }
  if (status === 'CANCELLED' || status === 'COMPLETED') {
    return 'revoked';
  }
  return 'inactive';
}

async function syncKeeperRecipe(payload: Record<string, unknown>) {
  const response = await fetch('/api/recipes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json().catch(() => null)) as { success?: boolean; error?: string } | null;
  if (!response.ok || !data?.success) {
    const errorMessage = data?.error || `Keeper sync failed with status ${response.status}.`;
    throw new Error(errorMessage);
  }
}

async function precheckDcaAllowance(payload: {
  userAddress: `0x${string}`;
  maxSlippageBps: number;
  totalDcaBudgetUsdc: string;
  perExecutionUsdc: string;
  targetAssetSymbol?: 'USDC' | 'EURC' | 'cirBTC';
}): Promise<DcaAllowancePrecheckResult> {
  const response = await fetch('/api/recipes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'allowancePrecheck',
      userAddress: payload.userAddress,
      recipeType: 'RECURRING_DCA',
      maxSlippageBps: payload.maxSlippageBps,
      parametersJson: {
        totalBudgetUsdc: payload.totalDcaBudgetUsdc,
        perExecutionAmountUsdc: payload.perExecutionUsdc,
        mode: 'PULL',
        ...(payload.targetAssetSymbol ? { targetAssetSymbol: payload.targetAssetSymbol } : {}),
      },
    }),
  });

  const data = (await response.json().catch(() => null)) as DcaAllowancePrecheckApiResponse | null;
  if (!response.ok || !data?.success || !data.allowance) {
    const errorMessage = data?.error || `Allowance precheck failed with status ${response.status}.`;
    throw new Error(errorMessage);
  }

  return data.allowance;
}

async function fetchSessionSpendQuota(payload: {
  userAddress: `0x${string}`;
  keeperSessionKeyAddress: `0x${string}`;
}): Promise<SessionSpendQuotaSnapshot | null> {
  const response = await fetch('/api/recipes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'sessionSpendQuota',
      userAddress: payload.userAddress,
      keeperSessionKeyAddress: payload.keeperSessionKeyAddress,
    }),
  });

  const data = (await response.json().catch(() => null)) as SessionSpendQuotaApiResponse | null;
  if (!response.ok || !data?.success || !data.quota) {
    return null;
  }

  return {
    maxUsdcSpendLimit: data.quota.maxUsdcSpendLimit || 'unknown',
    currentUsdcSpent: data.quota.currentUsdcSpent || 'unknown',
    remainingUsdcSpendLimit: data.quota.remainingUsdcSpendLimit || 'unknown',
    validUntil: data.quota.validUntil || null,
  };
}

export default function Home() {
  const { lang, t } = useLanguage();
  const locale = lang === 'vi' ? 'vi-VN' : 'en-US';
  const [selectedRecipe, setSelectedRecipe] = useState<RecipeConfig | null>(null);
  const [activeRecipes, setActiveRecipes] = useState<Record<string, ActiveRecipeState>>({});
  const [sessionSpendQuota, setSessionSpendQuota] = useState<SessionSpendQuotaSnapshot | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string>('');
  const [isActivating, setIsActivating] = useState(false);
  const [isUpdatingDelegation, setIsUpdatingDelegation] = useState(false);
  const [lastActionAt, setLastActionAt] = useState<number>(0);
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [runtimeKeeperSessionKeyAddress, setRuntimeKeeperSessionKeyAddress] = useState<`0x${string}` | null>(null);
  const [keeperAddressSyncWarning, setKeeperAddressSyncWarning] = useState<string>('');
  const [runtimeSessionKeyRegistryAddress, setRuntimeSessionKeyRegistryAddress] = useState<`0x${string}` | null>(null);
  const [sessionKeyRegistrySyncWarning, setSessionKeyRegistrySyncWarning] = useState<string>('');
  const [delegationDataSource, setDelegationDataSource] = useState<'keeper-db' | 'memory-fallback' | 'unknown'>('unknown');
  const keeperSessionKeyAddressRaw = (process.env.NEXT_PUBLIC_KEEPER_SESSION_KEY_ADDRESS || '').trim();
  const keeperSessionKeyAddress = isAddress(keeperSessionKeyAddressRaw)
    ? keeperSessionKeyAddressRaw
    : null;
  const configErrorMessage =
    keeperSessionKeyAddress || runtimeKeeperSessionKeyAddress
      ? ''
      : 'Unable to resolve keeper session key address from web/.env or keeper runtime health endpoint. Delegation is blocked until keeper is reachable and configuration is synced.';

  const resolveKeeperSessionKeyAddress = async (): Promise<`0x${string}`> => {
    try {
      const response = await fetch('/api/recipes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'keeperRuntimeConfig' }),
      });

      const data = (await response.json().catch(() => null)) as KeeperRuntimeConfigApiResponse | null;
      const runtimeAddressCandidate = data?.runtime?.keeperAddress?.trim() || '';
      const runtimeAddress = isAddress(runtimeAddressCandidate)
        ? runtimeAddressCandidate
        : null;

      if (runtimeAddress) {
        setRuntimeKeeperSessionKeyAddress(runtimeAddress);

        if (keeperSessionKeyAddress && keeperSessionKeyAddress.toLowerCase() !== runtimeAddress.toLowerCase()) {
          setKeeperAddressSyncWarning(
            `web/.env NEXT_PUBLIC_KEEPER_SESSION_KEY_ADDRESS (${keeperSessionKeyAddress}) is out-of-sync with keeper runtime address (${runtimeAddress}). ` +
            'Delegation flow now uses runtime keeper address from keeper /healthz. Please update web/.env to match.'
          );
        } else {
          setKeeperAddressSyncWarning('');
        }

        return runtimeAddress;
      }
    } catch {
      // Fallback to env-configured address below.
    }

    if (keeperSessionKeyAddress) {
      setRuntimeKeeperSessionKeyAddress(keeperSessionKeyAddress);
      setKeeperAddressSyncWarning('');
      return keeperSessionKeyAddress;
    }

    throw new Error(configErrorMessage);
  };

  const resolveSessionKeyRegistryAddress = useCallback(async (): Promise<`0x${string}`> => {
    if (!publicClient) {
      throw new Error('Public client is not ready yet. Please wait a moment and retry.');
    }

    let proxyResolvedRegistryAddress: `0x${string}` | null = null;
    try {
      const value = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.sharedExecutorProxy,
        abi: SHARED_EXECUTOR_PROXY_ABI,
        functionName: 'sessionKeyRegistry',
      });

      if (isAddress(value)) {
        proxyResolvedRegistryAddress = value;
      }
    } catch {
      // Fallback to configured address below.
    }

    const candidates = Array.from(
      new Set(
        [proxyResolvedRegistryAddress, CONTRACT_ADDRESSES.sessionKeyRegistry]
          .filter((value): value is `0x${string}` => Boolean(value))
          .map((value) => value.toLowerCase())
      )
    ) as `0x${string}`[];

    for (const candidate of candidates) {
      try {
        const bytecode = await publicClient.getBytecode({ address: candidate });
        if (bytecode && bytecode !== '0x') {
          setRuntimeSessionKeyRegistryAddress(candidate);

          if (
            proxyResolvedRegistryAddress &&
            proxyResolvedRegistryAddress.toLowerCase() !== CONTRACT_ADDRESSES.sessionKeyRegistry.toLowerCase()
          ) {
            setSessionKeyRegistrySyncWarning(
              `web/.env NEXT_PUBLIC_SESSION_KEY_REGISTRY_ADDRESS (${CONTRACT_ADDRESSES.sessionKeyRegistry}) ` +
              `is out-of-sync with SharedExecutorProxy.sessionKeyRegistry() (${proxyResolvedRegistryAddress}). ` +
              'Activation flow now uses proxy-resolved runtime address.'
            );
          } else {
            setSessionKeyRegistrySyncWarning('');
          }

          return candidate;
        }
      } catch {
        // Try next candidate.
      }
    }

    throw new Error(
      'Unable to resolve a valid SessionKeyRegistry contract address on Arc Testnet. ' +
      'Verify NEXT_PUBLIC_SESSION_KEY_REGISTRY_ADDRESS and SharedExecutorProxy deployment wiring.'
    );
  }, [publicClient]);

  useEffect(() => {
    if (!publicClient) {
      return;
    }

    void resolveSessionKeyRegistryAddress().catch(() => {
      // Keep lazy resolution path for action handlers and avoid noisy UI errors on first load.
    });
  }, [publicClient, resolveSessionKeyRegistryAddress]);

  useEffect(() => {
    if (!isConnected || !address || !isAddress(address)) {
      setActiveRecipes({});
      setDelegationDataSource('unknown');
      return;
    }

    let cancelled = false;

    const loadActiveRecipes = async () => {
      try {
        const url = new URL('/api/recipes', window.location.origin);
        url.searchParams.set('userAddress', address);
        url.searchParams.set('limit', '100');

        const response = await fetch(url.toString(), {
          method: 'GET',
          cache: 'no-store',
        });
        const data = (await response.json().catch(() => null)) as PersistedActiveRecipesApiResponse | null;

        if (!response.ok || !data?.success || !Array.isArray(data.recipes)) {
          return;
        }

        if (!cancelled) {
          setDelegationDataSource(data.dataSource || 'unknown');
        }

        const nextState: Record<string, ActiveRecipeState> = {};

        for (const recipe of data.recipes) {
          if (!recipe.recipeType) {
            continue;
          }

          const recipeConfig = RECIPES.find((candidate) => candidate.recipeType === recipe.recipeType);
          if (!recipeConfig) {
            continue;
          }

          const lifecycleStatus = mapBackendStatusToLifecycleStatus(recipe.status);
          if (lifecycleStatus === 'inactive') {
            continue;
          }

          nextState[recipeConfig.id] = {
            id: recipeConfig.id,
            recipeType: recipeConfig.recipeType,
            targetProtocolAddress: recipeConfig.targetProtocolAddress,
            status: lifecycleStatus,
            txLifecycleStatus: 'confirmed',
            maxSlippageBps: typeof recipe.maxSlippageBps === 'number' ? recipe.maxSlippageBps : recipeConfig.maxSlippageBps,
            sessionSpendLimitUsdc: recipe.sessionSpendLimitUsdc || recipe.maxUsdcSpendLimit || 'unknown',
            validUntil: recipe.delegationValidUntil || recipe.createdAt || new Date().toISOString(),
            txHash: recipe.delegationTxHash && /^0x[a-fA-F0-9]{64}$/.test(recipe.delegationTxHash)
              ? recipe.delegationTxHash as `0x${string}`
              : null,
            checkIntervalHours: recipe.checkIntervalHours,
            intervalPreset: recipe.intervalPreset,
          };
        }

        if (!cancelled) {
          setActiveRecipes(nextState);
        }
      } catch {
        if (!cancelled) {
          setDelegationDataSource('unknown');
        }
        // Keep UI usable even when persistence source is temporarily unavailable.
      }
    };

    void loadActiveRecipes();

    return () => {
      cancelled = true;
    };
  }, [isConnected, address]);

  useEffect(() => {
    const resolvedKeeperSessionKeyAddress = runtimeKeeperSessionKeyAddress || keeperSessionKeyAddress;
    if (!isConnected || !address || !isAddress(address) || !resolvedKeeperSessionKeyAddress || Object.keys(activeRecipes).length === 0) {
      setSessionSpendQuota(null);
      return;
    }

    let cancelled = false;

    void fetchSessionSpendQuota({
      userAddress: address,
      keeperSessionKeyAddress: resolvedKeeperSessionKeyAddress,
    }).then((quota) => {
      if (!cancelled) {
        setSessionSpendQuota(quota);
      }
    }).catch(() => {
      if (!cancelled) {
        setSessionSpendQuota(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isConnected, address, runtimeKeeperSessionKeyAddress, keeperSessionKeyAddress, activeRecipes]);

  const ensureWalletReady = async (): Promise<WalletReadyContext> => {
    if (!isConnected || !address) {
      throw new Error('Please connect a wallet before updating delegation.');
    }
    const resolvedKeeperSessionKeyAddress = await resolveKeeperSessionKeyAddress();
    if (address.toLowerCase() === resolvedKeeperSessionKeyAddress.toLowerCase()) {
      throw new Error(
        'Invalid NEXT_PUBLIC_KEEPER_SESSION_KEY_ADDRESS: it matches the connected user wallet. ' +
        'Set this value to the off-chain keeper EOA address from keeper/.env (derived from KEEPER_PRIVATE_KEY).'
      );
    }
    if (chainId !== ARC_TESTNET_CHAIN_ID) {
      if (!switchChain) {
        throw new Error('Wallet does not support automatic network switching. Please switch to Arc Testnet (5042002).');
      }
      await switchChain({ chainId: ARC_TESTNET_CHAIN_ID });
    }
    if (!publicClient) {
      throw new Error('Public client is not ready yet. Please wait a moment and retry.');
    }
    const resolvedSessionKeyRegistryAddress = await resolveSessionKeyRegistryAddress();

    return {
      connectedAddress: address,
      keeperSessionKeyAddress: resolvedKeeperSessionKeyAddress,
      sessionKeyRegistryAddress: resolvedSessionKeyRegistryAddress,
    };
  };

  const ensureSessionKeyDelegation = async (
    connectedAddress: `0x${string}`,
    configuredKeeperSessionKeyAddress: `0x${string}`,
    sessionKeyRegistryAddress: `0x${string}`,
    requestedSpendLimitBaseUnits: bigint
  ): Promise<DelegationSetupResult> => {
    if (!publicClient) {
      throw new Error('Public client is not ready yet. Please wait a moment and retry.');
    }

    const permission = await publicClient.readContract({
      address: sessionKeyRegistryAddress,
      abi: SESSION_KEY_REGISTRY_ABI,
      functionName: 'getSessionPermission',
      args: [connectedAddress, configuredKeeperSessionKeyAddress],
    });

    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    const isActive = permission.exists && !permission.revoked && permission.validUntil > nowSeconds;
    // A key can stay "valid" while its cumulative spend quota is exhausted, which makes every
    // keeper execution revert with ExceededSpendLimit(). Re-registering resets currentUsdcSpent.
    const hasSpendHeadroom =
      permission.maxUsdcSpendLimit === 0n ||
      permission.maxUsdcSpendLimit - permission.currentUsdcSpent >= MIN_SESSION_SPEND_HEADROOM;
    // The session spend quota is shared cumulatively across every recipe under this
    // userAddress + keeper session key pair, so it must exactly match what the user selected.
    const quotaMatchesRequest = permission.maxUsdcSpendLimit === requestedSpendLimitBaseUnits;

    if (isActive && hasSpendHeadroom && quotaMatchesRequest) {
      return {
        txHash: null,
        alreadyValid: true,
      };
    }

    if (isActive && quotaMatchesRequest === false) {
      setFeedbackMessage(
        'Selected session spending limit differs from the currently registered delegation. ' +
        'Renewing delegation now: this resets cumulative spend (currentUsdcSpent) back to 0 for this wallet + keeper session key.'
      );
    }

    const validUntilMs = Date.now() + DEFAULT_SESSION_VALIDITY_MS;
    const validUntilSeconds = BigInt(Math.floor(validUntilMs / 1000));

    const txHash = await sendContractWithRetry(
      {
        address: sessionKeyRegistryAddress,
        abi: SESSION_KEY_REGISTRY_ABI,
        functionName: 'registerSessionKey',
        args: [configuredKeeperSessionKeyAddress, validUntilSeconds, requestedSpendLimitBaseUnits],
        chainId: ARC_TESTNET_CHAIN_ID,
      },
      {
        onRetry: (attempt, maxAttempts) => {
          setFeedbackMessage(`Arc RPC is busy. Retrying transaction submission (${attempt}/${maxAttempts - 1})...`);
        },
      }
    );

    return {
      txHash,
      alreadyValid: false,
    };
  };

  const enforceActionCooldown = () => {
    const now = Date.now();
    if (now - lastActionAt < TX_ACTION_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((TX_ACTION_COOLDOWN_MS - (now - lastActionAt)) / 1000);
      throw new Error(`Please wait ${waitSeconds}s before sending another on-chain action.`);
    }
    setLastActionAt(now);
  };

  const waitForReceiptWithTimeout = async (
    hash: `0x${string}`,
    timeoutMs: number,
    options?: {
      onRateLimitRetry?: (attempt: number) => void;
    }
  ): Promise<boolean> => {
    if (!publicClient) {
      throw new Error('Public client is not ready yet. Please wait a moment and retry.');
    }

    const startedAt = Date.now();
    let attempt = 0;

    while (Date.now() - startedAt < timeoutMs) {
      attempt += 1;
      try {
        const receipt = await publicClient.getTransactionReceipt({ hash });
        return receipt.status === 'success';
      } catch (error: unknown) {
        if (isPendingReceiptError(error)) {
          await sleep(TX_CONFIRM_POLL_INTERVAL_MS);
          continue;
        }

        if (isRateLimitError(error)) {
          options?.onRateLimitRetry?.(attempt);
          await sleep(getRetryDelayMs(attempt, TX_CONFIRM_POLL_INTERVAL_MS));
          continue;
        }

        throw error;
      }
    }

    return false;
  };

  const confirmTransactionInBackground = (
    hash: `0x${string}`,
    onConfirmed: () => void,
    onFailed: (reason: string) => void,
    onTimeout: () => void
  ) => {
    void (async () => {
      const confirmedInPrimaryWindow = await waitForReceiptWithTimeout(hash, TX_CONFIRM_TIMEOUT_MS, {
        onRateLimitRetry: (attempt) => {
          setFeedbackMessage(`Transaction submitted. Network busy while confirming (retry #${attempt})...`);
        },
      });

      if (confirmedInPrimaryWindow) {
        onConfirmed();
        return;
      }

      onTimeout();

      for (let round = 1; round <= TX_CONFIRM_BACKGROUND_MAX_ROUNDS; round += 1) {
        await sleep(TX_CONFIRM_BACKGROUND_DELAY_MS);
        const confirmed = await waitForReceiptWithTimeout(hash, TX_CONFIRM_TIMEOUT_MS);
        if (confirmed) {
          onConfirmed();
          return;
        }
      }

      onFailed('Transaction is still pending after background confirmation retries.');
    })().catch((error: unknown) => {
      onFailed(getErrorMessage(error));
    });
  };

  const sendContractWithRetry = async (
    request: Parameters<typeof writeContractAsync>[0],
    options?: {
      onRetry?: (attempt: number, maxAttempts: number) => void;
    }
  ) => {
    let lastError: unknown;

    for (let attempt = 1; attempt <= TX_SEND_MAX_RETRIES; attempt += 1) {
      try {
        return await writeContractAsync(request);
      } catch (error: unknown) {
        lastError = error;
        const canRetry = isRateLimitError(error) && attempt < TX_SEND_MAX_RETRIES;
        if (!canRetry) {
          throw error;
        }

        options?.onRetry?.(attempt, TX_SEND_MAX_RETRIES);
        await sleep(getRetryDelayMs(attempt));
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Transaction submission failed.');
  };

  const ensureDcaUsdcAllowance = async (
    connectedAddress: `0x${string}`,
    requiredAllowanceBaseUnits: bigint,
    _executionMode: DcaExecutionMode,
    spender: `0x${string}`
  ): Promise<void> => {
    if (!publicClient) {
      throw new Error('Public client is not ready yet. Please wait a moment and retry.');
    }

    const currentAllowance = await publicClient.readContract({
      address: CONTRACT_ADDRESSES.usdc,
      abi: ERC20_ALLOWANCE_AND_APPROVE_ABI,
      functionName: 'allowance',
      args: [connectedAddress, spender],
    });

    if (currentAllowance >= requiredAllowanceBaseUnits) {
      return;
    }

    setFeedbackMessage(
      'USDC allowance is below required DCA pull-per-run budget. ' +
      `Approving spender ${spender} for ${requiredAllowanceBaseUnits.toString()} base units...`
    );

    const approveTxHash = await sendContractWithRetry(
      {
        address: CONTRACT_ADDRESSES.usdc,
        abi: ERC20_ALLOWANCE_AND_APPROVE_ABI,
        functionName: 'approve',
        args: [spender, requiredAllowanceBaseUnits],
        chainId: ARC_TESTNET_CHAIN_ID,
      },
      {
        onRetry: (attempt, maxAttempts) => {
          setFeedbackMessage(`Arc RPC is busy. Retrying USDC approve submission (${attempt}/${maxAttempts - 1})...`);
        },
      }
    );

    const approvedInTime = await waitForReceiptWithTimeout(approveTxHash, TX_CONFIRM_TIMEOUT_MS, {
      onRateLimitRetry: (attempt) => {
        setFeedbackMessage(`Approve submitted. Network busy while confirming approve (retry #${attempt})...`);
      },
    });

    const refreshedAllowance = await publicClient.readContract({
      address: CONTRACT_ADDRESSES.usdc,
      abi: ERC20_ALLOWANCE_AND_APPROVE_ABI,
      functionName: 'allowance',
      args: [connectedAddress, spender],
    });

    if (refreshedAllowance < requiredAllowanceBaseUnits) {
      throw new Error(
        `USDC approve is not confirmed yet. Scheduler will continue to skip enqueue until allowance reaches ` +
        `${requiredAllowanceBaseUnits.toString()} base units for spender ${spender}.`
      );
    }

    if (approvedInTime) {
      setFeedbackMessage(
        `USDC approve confirmed for spender ${spender}. Continuing recipe activation...`
      );
    } else {
      setFeedbackMessage(
        `USDC approve propagated in allowance state for spender ${spender}. Continuing recipe activation...`
      );
    }
  };

  const handleConfirmSimulation = async ({
    maxSlippageBps,
    sessionSpendLimitUsdc,
    dcaConfig,
    intervalHours,
    intervalPreset,
    swapProvider,
  }: {
    maxSlippageBps: number;
    sessionSpendLimitUsdc: string;
    intervalHours: number;
    intervalPreset: IntervalPreset;
    swapProvider?: SwapProvider;
    dcaConfig?: {
      totalDcaBudgetUsdc: string;
      perExecutionUsdc: string;
      executionMode: DcaExecutionMode;
      runtimeSpender?: `0x${string}`;
      requiredSpenders?: `0x${string}`[];
    };
  }) => {
    if (!selectedRecipe || isActivating) return;

    setIsActivating(true);

    try {
      enforceActionCooldown();
      const requestedSpendLimitBaseUnits = parseUsdcAmountToBaseUnits(
        sessionSpendLimitUsdc,
        'Session spending limit'
      );
      const {
        connectedAddress,
        keeperSessionKeyAddress: configuredKeeperSessionKeyAddress,
        sessionKeyRegistryAddress,
      } = await ensureWalletReady();
      const selectedRecipeSnapshot = selectedRecipe;
      const validUntil = new Date(Date.now() + DEFAULT_SESSION_VALIDITY_MS).toISOString();

      let normalizedDcaPayload:
        | {
            totalDcaBudgetUsdc: string;
            perExecutionUsdc: string;
            executionMode: DcaExecutionMode;
            totalDcaBudgetBaseUnits: bigint;
            perExecutionBaseUnits: bigint;
          }
        | undefined = undefined;

      if (selectedRecipeSnapshot.recipeType === 'RECURRING_DCA') {
        if (!dcaConfig) {
          throw new Error('DCA configuration is required for recurring DCA recipe activation.');
        }

        const parsedDcaConfig = parseDcaActivationConfig(dcaConfig);
        const runs = estimateDcaRuns(
          parsedDcaConfig.totalDcaBudgetBaseUnits,
          parsedDcaConfig.perExecutionBaseUnits
        );
        if (runs <= 0n) {
          throw new Error('Estimated runs must be at least 1 for DCA activation.');
        }

        let runtimeSpender: `0x${string}` | null =
          dcaConfig.runtimeSpender && isAddress(dcaConfig.runtimeSpender)
            ? dcaConfig.runtimeSpender
            : null;
        let runtimeRequiredSpenders: `0x${string}`[] =
          dcaConfig.requiredSpenders?.filter((spender) => isAddress(spender)) || [];

        if (!runtimeSpender || runtimeRequiredSpenders.length === 0) {
          try {
            const allowancePrecheck = await precheckDcaAllowance({
              userAddress: connectedAddress,
              maxSlippageBps,
              totalDcaBudgetUsdc: dcaConfig.totalDcaBudgetUsdc.trim(),
              perExecutionUsdc: dcaConfig.perExecutionUsdc.trim(),
              targetAssetSymbol: selectedRecipeSnapshot.targetAssetSymbol,
            });
            runtimeSpender = allowancePrecheck.runtimeSpender;
            runtimeRequiredSpenders = allowancePrecheck.requiredSpenders?.filter((spender) => isAddress(spender)) || [];
          } catch (precheckError: unknown) {
            setFeedbackMessage(
              `Allowance precheck warning: ${getErrorMessage(precheckError)}. Continuing with default spender approvals...`
            );
          }
        }

        // Always approve SharedExecutorProxy (primary spender that pulls from user).
        await ensureDcaUsdcAllowance(
          connectedAddress,
          parsedDcaConfig.totalDcaBudgetBaseUnits,
          parsedDcaConfig.executionMode,
          CONTRACT_ADDRESSES.sharedExecutorProxy
        );

        // Also approve all runtime-required spenders returned by the keeper precheck
        // (e.g. LI.FI Fly Router, Curve Pool) — these are route-specific and vary by
        // swap provider. Missing any one of them causes ERC20 transfer revert mid-execution.
        const spendersToApprove = new Set<`0x${string}`>(
          runtimeRequiredSpenders.map((s) => s.toLowerCase() as `0x${string}`)
        );
        // Remove SharedExecutorProxy — already approved above.
        spendersToApprove.delete(CONTRACT_ADDRESSES.sharedExecutorProxy.toLowerCase() as `0x${string}`);
        for (const spender of spendersToApprove) {
          await ensureDcaUsdcAllowance(
            connectedAddress,
            parsedDcaConfig.totalDcaBudgetBaseUnits,
            parsedDcaConfig.executionMode,
            spender
          );
        }

        normalizedDcaPayload = {
          totalDcaBudgetUsdc: dcaConfig.totalDcaBudgetUsdc.trim(),
          perExecutionUsdc: dcaConfig.perExecutionUsdc.trim(),
          executionMode: parsedDcaConfig.executionMode,
          totalDcaBudgetBaseUnits: parsedDcaConfig.totalDcaBudgetBaseUnits,
          perExecutionBaseUnits: parsedDcaConfig.perExecutionBaseUnits,
        };
      }

      const delegationResult = await ensureSessionKeyDelegation(
        connectedAddress,
        configuredKeeperSessionKeyAddress,
        sessionKeyRegistryAddress,
        requestedSpendLimitBaseUnits
      );

      const checkIntervalHours = parseIntervalHours(intervalHours);

      await syncKeeperRecipe({
        action: 'register',
        userAddress: connectedAddress,
        recipeType: selectedRecipeSnapshot.recipeType,
        recipeName: selectedRecipeSnapshot.name,
        txHash: delegationResult.txHash,
        ...(selectedRecipeSnapshot.targetProtocolAddress
          ? { targetProtocolAddress: selectedRecipeSnapshot.targetProtocolAddress }
          : {}),
        ...(swapProvider
          ? { swapProvider }
          : selectedRecipeSnapshot.swapProvider
            ? { swapProvider: selectedRecipeSnapshot.swapProvider }
            : {}),
        maxSlippageBps,
        maxUsdcSpendLimit: sessionSpendLimitUsdc.trim(),
        parametersJson: {
          delegationValidUntil: validUntil,
          checkIntervalHours,
          intervalPreset,
          maxSlippageBps,
          sessionSpendLimitUsdc: sessionSpendLimitUsdc.trim(),
          sessionSpendLimitBaseUnits: requestedSpendLimitBaseUnits.toString(),
          ...(selectedRecipeSnapshot.recipeType === 'RECURRING_DCA' && normalizedDcaPayload
            ? {
                totalBudgetUsdc: normalizedDcaPayload.totalDcaBudgetUsdc,
                totalBudgetBaseUnits: normalizedDcaPayload.totalDcaBudgetBaseUnits.toString(),
                perExecutionAmountUsdc: normalizedDcaPayload.perExecutionUsdc,
                perExecutionAmountBaseUnits: normalizedDcaPayload.perExecutionBaseUnits.toString(),
                spentAmountBaseUnits: '0',
                executedCount: 0,
                mode: normalizedDcaPayload.executionMode,
                status: 'ACTIVE',
                dcaAmountUsdc: normalizedDcaPayload.perExecutionUsdc,
                dcaAmountUsdcBaseUnits: normalizedDcaPayload.perExecutionBaseUnits.toString(),
              }
            : {}),
          ...(selectedRecipeSnapshot.targetAssetSymbol
            ? { targetAssetSymbol: selectedRecipeSnapshot.targetAssetSymbol }
            : {}),
        },
      });

      setActiveRecipes((previous) => ({
        ...previous,
        [selectedRecipeSnapshot.id]: {
          id: selectedRecipeSnapshot.id,
          recipeType: selectedRecipeSnapshot.recipeType,
          targetProtocolAddress: selectedRecipeSnapshot.targetProtocolAddress,
          status: 'active',
          txLifecycleStatus: delegationResult.alreadyValid ? 'already-valid' : 'submitted',
          maxSlippageBps,
          sessionSpendLimitUsdc: sessionSpendLimitUsdc.trim(),
          validUntil,
          txHash: delegationResult.txHash,
        },
      }));

      const delegationMessage = delegationResult.alreadyValid
        ? 'Delegation already valid for this wallet. '
        : `Delegation submitted. Waiting for confirmation in background. View tx on ArcScan: https://testnet.arcscan.app/tx/${delegationResult.txHash} `;

      const dcaMessage =
        selectedRecipeSnapshot.recipeType === 'RECURRING_DCA' && normalizedDcaPayload
          ? `DCA configured with total budget ${normalizedDcaPayload.totalDcaBudgetUsdc} USDC, ` +
            `${normalizedDcaPayload.perExecutionUsdc} USDC per run, mode PULL_PER_RUN. `
          : '';

      setFeedbackMessage(
        `${selectedRecipeSnapshot.name} activated. ${dcaMessage}${delegationMessage}`
      );

      if (delegationResult.txHash) {
        confirmTransactionInBackground(
          delegationResult.txHash,
          () => {
            setActiveRecipes((previous) => {
              const current = previous[selectedRecipeSnapshot.id];
              if (!current) return previous;
              return {
                ...previous,
                [selectedRecipeSnapshot.id]: {
                  ...current,
                  txLifecycleStatus: 'confirmed',
                },
              };
            });
            setFeedbackMessage(
              `${selectedRecipeSnapshot.name} delegation confirmed on-chain. View tx on ArcScan: https://testnet.arcscan.app/tx/${delegationResult.txHash}`
            );
          },
          (reason) => {
            setActiveRecipes((previous) => {
              const current = previous[selectedRecipeSnapshot.id];
              if (!current) return previous;
              return {
                ...previous,
                [selectedRecipeSnapshot.id]: {
                  ...current,
                  txLifecycleStatus: 'failed',
                },
              };
            });
            setFeedbackMessage(`Delegation confirmation failed: ${reason}`);
          },
          () => {
            setActiveRecipes((previous) => {
              const current = previous[selectedRecipeSnapshot.id];
              if (!current) return previous;
              return {
                ...previous,
                [selectedRecipeSnapshot.id]: {
                  ...current,
                  txLifecycleStatus: 'timeout',
                },
              };
            });
            setFeedbackMessage(
              `Delegation submitted and still pending after ${Math.round(TX_CONFIRM_TIMEOUT_MS / 1000)}s. Background confirmation will keep retrying.`
            );
          }
        );
      }

      setSelectedRecipe(null);
    } catch (error: unknown) {
      setFeedbackMessage(`Activation failed: ${getErrorMessage(error)}`);
    } finally {
      setIsActivating(false);
    }
  };

  const handlePauseRecipe = async (recipeId: string) => {
    if (isUpdatingDelegation) return;

    const currentRecipe = activeRecipes[recipeId];
    if (!currentRecipe || currentRecipe.status === 'revoked') return;

    setIsUpdatingDelegation(true);
    try {
      enforceActionCooldown();
      const { connectedAddress } = await ensureWalletReady();
      const willPause = currentRecipe.status !== 'paused';
      const txHash = await sendContractWithRetry(
        {
          address: CONTRACT_ADDRESSES.sharedExecutorProxy,
          abi: SHARED_EXECUTOR_PROXY_ABI,
          functionName: willPause ? 'pauseMyRecipes' : 'unpauseMyRecipes',
          args: [],
          chainId: ARC_TESTNET_CHAIN_ID,
        },
        {
          onRetry: (attempt, maxAttempts) => {
            setFeedbackMessage(
              `Arc RPC is busy. Retrying transaction submission (${attempt}/${maxAttempts - 1})...`
            );
          },
        }
      );
      setActiveRecipes((previous) => {
        const existing = previous[recipeId];
        if (!existing || existing.status === 'revoked') {
          return previous;
        }
        const nextStatus: RecipeLifecycleStatus = willPause ? 'paused' : 'active';
        return {
          ...previous,
          [recipeId]: { ...existing, status: nextStatus, txLifecycleStatus: 'submitted' as TxLifecycleStatus, txHash },
        };
      });

      let keeperSyncWarning = '';
      try {
        await syncKeeperRecipe({
          action: 'status',
          userAddress: connectedAddress,
          recipeType: currentRecipe.recipeType,
          status: willPause ? 'PAUSED' : 'ACTIVE',
          txHash,
        });
      } catch (syncError: unknown) {
        keeperSyncWarning = ` Keeper sync warning: ${getErrorMessage(syncError)}`;
      }

      setFeedbackMessage(
        `Delegation ${willPause ? 'pause' : 'resume'} submitted. Waiting for confirmation in background. View tx on ArcScan: https://testnet.arcscan.app/tx/${txHash}${keeperSyncWarning}`
      );

      confirmTransactionInBackground(
        txHash,
        () => {
          setFeedbackMessage(
            `Delegation ${willPause ? 'paused' : 'resumed'} on-chain (confirmed). View tx on ArcScan: https://testnet.arcscan.app/tx/${txHash}`
          );
        },
        (reason) => {
          setFeedbackMessage(`Pause/Resume confirmation failed: ${reason}`);
        },
        () => {
          setFeedbackMessage(
            `Pause/Resume transaction is pending beyond ${Math.round(TX_CONFIRM_TIMEOUT_MS / 1000)}s. Background finalizer is retrying.`
          );
        }
      );
    } catch (error: unknown) {
      setFeedbackMessage(`Pause/Resume failed: ${getErrorMessage(error)}`);
    } finally {
      setIsUpdatingDelegation(false);
    }
  };

  const handleRevokeRecipe = async (recipeId: string) => {
    if (isUpdatingDelegation) return;

    const currentRecipe = activeRecipes[recipeId];
    if (!currentRecipe || currentRecipe.status === 'revoked') return;

    setIsUpdatingDelegation(true);
    try {
      enforceActionCooldown();
      const {
        connectedAddress,
        keeperSessionKeyAddress: configuredKeeperSessionKeyAddress,
        sessionKeyRegistryAddress,
      } = await ensureWalletReady();

      if (!publicClient) {
        throw new Error('Public client is not ready yet. Please wait a moment and retry.');
      }

      // On-chain state may already be revoked (e.g. keeper DB sync missed the previous
      // revoke), which would otherwise revert with SessionKeyAlreadyRevoked/NotFound.
      const existingPermission = await publicClient.readContract({
        address: sessionKeyRegistryAddress,
        abi: SESSION_KEY_REGISTRY_ABI,
        functionName: 'getSessionPermission',
        args: [connectedAddress, configuredKeeperSessionKeyAddress],
      });

      if (!existingPermission.exists || existingPermission.revoked) {
        setActiveRecipes((previous) => {
          const existing = previous[recipeId];
          if (!existing) {
            return previous;
          }
          return {
            ...previous,
            [recipeId]: {
              ...existing,
              status: 'revoked' as RecipeLifecycleStatus,
              txLifecycleStatus: 'confirmed' as TxLifecycleStatus,
            },
          };
        });

        try {
          await syncKeeperRecipe({
            action: 'status',
            userAddress: connectedAddress,
            recipeType: currentRecipe.recipeType,
            status: 'CANCELLED',
          });
        } catch {
          // Keeper sync is best-effort here; on-chain state is already the safe end state.
        }

        setFeedbackMessage('Session key is already revoked on-chain. Local status has been synced.');
        return;
      }

      const txHash = await sendContractWithRetry(
        {
          address: sessionKeyRegistryAddress,
          abi: SESSION_KEY_REGISTRY_ABI,
          functionName: 'revokeSessionKey',
          args: [configuredKeeperSessionKeyAddress],
          chainId: ARC_TESTNET_CHAIN_ID,
        },
        {
          onRetry: (attempt, maxAttempts) => {
            setFeedbackMessage(
              `Arc RPC is busy. Retrying transaction submission (${attempt}/${maxAttempts - 1})...`
            );
          },
        }
      );
      setActiveRecipes((previous) => {
        const existing = previous[recipeId];
        if (!existing) {
          return previous;
        }
        return {
          ...previous,
          [recipeId]: {
            ...existing,
            status: 'revoked' as RecipeLifecycleStatus,
            txLifecycleStatus: 'submitted' as TxLifecycleStatus,
            txHash,
          },
        };
      });

      let keeperSyncWarning = '';
      try {
        await syncKeeperRecipe({
          action: 'status',
          userAddress: connectedAddress,
          recipeType: currentRecipe.recipeType,
          status: 'CANCELLED',
          txHash,
        });
      } catch (syncError: unknown) {
        keeperSyncWarning = ` Keeper sync warning: ${getErrorMessage(syncError)}`;
      }

      setFeedbackMessage(
        `Delegation revoke submitted. Waiting for confirmation in background. View tx on ArcScan: https://testnet.arcscan.app/tx/${txHash}${keeperSyncWarning}`
      );

      confirmTransactionInBackground(
        txHash,
        () => {
          setFeedbackMessage(`Delegation revoked on-chain (confirmed). View tx on ArcScan: https://testnet.arcscan.app/tx/${txHash}`);
        },
        (reason) => {
          setFeedbackMessage(`Revoke confirmation failed: ${reason}`);
        },
        () => {
          setFeedbackMessage(
            `Revoke transaction is pending beyond ${Math.round(TX_CONFIRM_TIMEOUT_MS / 1000)}s. Background finalizer is retrying.`
          );
        }
      );
    } catch (error: unknown) {
      setFeedbackMessage(`Revoke failed: ${getErrorMessage(error)}`);
    } finally {
      setIsUpdatingDelegation(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8 space-y-10">
        {/* Hero Section */}
        <div className="glass-card p-8 relative overflow-hidden">
          <div className="absolute -right-10 -bottom-10 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -left-10 -top-10 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 space-y-4 max-w-3xl">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-950/80 border border-blue-800 text-blue-400 text-xs font-semibold">
              <Sparkles className="h-3.5 w-3.5" />
              <span>{t('heroBadge')}</span>
            </div>

            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-tight" style={{ color: 'var(--ink)' }}>
              {t('heroTitle')} <span className="gradient-text">{t('heroTitleAccent')}</span>
            </h1>

            <p className="text-base leading-relaxed" style={{ color: 'var(--ink-2)' }}>
              {t('heroDescription')}
            </p>

            <div className="flex flex-wrap gap-4 pt-2 text-xs font-mono" style={{ color: 'var(--muted)' }}>
              <div className="flex items-center space-x-1.5">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                <span>{t('heroProxy')}</span>
              </div>
              <div className="flex items-center space-x-1.5">
                <Cpu className="h-4 w-4 text-blue-400" />
                <span>{t('heroSimulation')}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Recipe Catalog */}
        <RecipeCatalog onSelectRecipe={(recipe) => setSelectedRecipe(recipe)} />

        <section className="glass-card overflow-hidden">
          {/* Section header */}
          <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: 'rgba(172,198,233,0.10)' }}>
                <Activity className="h-3.5 w-3.5" style={{ color: 'var(--accent)' }} />
              </div>
              <h2 className="display text-base font-semibold text-ink">{t('activeDelegations')}</h2>
              {/* Data source badge */}
              <span className="mono rounded-full border px-2 py-0.5 text-[10px]"
                style={{ borderColor: 'var(--border)', color: 'var(--subtle)', background: 'var(--surface-inner)' }}>
                {delegationDataSource === 'keeper-db' ? t('keeperDb') : delegationDataSource === 'memory-fallback' ? t('memoryFallback') : t('unknown')}
              </span>
            </div>
            <span className="text-xs" style={{ color: 'var(--subtle)' }}>{t('pauseRevoke')}</span>
          </div>

          <div className="p-6 space-y-4">
            {/* Alert banners */}
            {configErrorMessage ? (
              <div className="flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm" style={{ borderColor: 'rgba(235,87,87,0.30)', background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{configErrorMessage}</span>
              </div>
            ) : null}
            {(keeperAddressSyncWarning || sessionKeyRegistrySyncWarning) ? (
              <div className="flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm" style={{ borderColor: 'rgba(242,153,74,0.30)', background: 'var(--warning-bg)', color: 'var(--warning)' }}>
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{keeperAddressSyncWarning || sessionKeyRegistrySyncWarning}</span>
              </div>
            ) : null}
            {feedbackMessage ? (
              <div className="flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm" style={{ borderColor: 'rgba(172,198,233,0.25)', background: 'rgba(172,198,233,0.07)', color: 'var(--accent)' }}>
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{feedbackMessage}</span>
              </div>
            ) : null}

            {/* Runtime routing (collapsed, subtle) */}
            <details className="group">
              <summary className="flex cursor-pointer items-center gap-1.5 text-[11px] select-none list-none" style={{ color: 'var(--subtle)' }}>
                <RotateCcw className="h-3 w-3" />
                <span className="uppercase tracking-wider font-mono">{t('runtimeRouting')}</span>
                <span className="ml-auto text-[10px] group-open:hidden">▸</span>
                <span className="ml-auto text-[10px] hidden group-open:inline">▾</span>
              </summary>
              <div className="mt-2 rounded-xl border px-3 py-2.5 space-y-1 text-xs font-mono" style={{ borderColor: 'var(--border)', background: 'var(--surface-inner)', color: 'var(--muted)' }}>
                <div>{t('sessionKeyInUse')}:{' '}
                  <a href={`https://testnet.arcscan.app/address/${runtimeSessionKeyRegistryAddress || CONTRACT_ADDRESSES.sessionKeyRegistry}`}
                    target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 hover:underline break-all" style={{ color: 'var(--accent)' }}>
                    {(runtimeSessionKeyRegistryAddress || CONTRACT_ADDRESSES.sessionKeyRegistry).slice(0, 16)}…
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                </div>
                <div style={{ color: 'var(--subtle)' }}>{t('source')}: {runtimeSessionKeyRegistryAddress ? t('runtimeResolution') : t('configFallback')}</div>
              </div>
            </details>

            {/* Session quota (only when recipes active) */}
            {Object.keys(activeRecipes).length > 0 && sessionSpendQuota ? (
              <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'rgba(172,198,233,0.20)', background: 'rgba(172,198,233,0.05)' }}>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>{t('sessionQuotaSummaryTitle')}</span>
                  <span className="text-[11px]" style={{ color: 'var(--subtle)' }}>{t('sessionQuotaSharedNotice')}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: t('sessionQuotaLimit'), value: `${sessionSpendQuota.maxUsdcSpendLimit} USDC`, color: 'var(--ink)' },
                    { label: t('sessionQuotaSpent'), value: `${sessionSpendQuota.currentUsdcSpent} USDC`, color: 'var(--warning)' },
                    { label: t('sessionQuotaRemaining'), value: `${sessionSpendQuota.remainingUsdcSpendLimit} USDC`, color: 'var(--success)' },
                    { label: t('sessionQuotaValidUntil'), value: sessionSpendQuota.validUntil ? new Date(sessionSpendQuota.validUntil).toLocaleDateString(locale) : t('notAvailable'), color: 'var(--ink)' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="rounded-lg p-2.5" style={{ background: 'var(--surface-inner)', border: '1px solid var(--border)' }}>
                      <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--subtle)' }}>{label}</div>
                      <div className="mono text-xs font-semibold" style={{ color }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : Object.keys(activeRecipes).length > 0 ? (
              <div className="text-xs" style={{ color: 'var(--subtle)' }}>{t('sessionQuotaUnavailable')}</div>
            ) : null}

            {/* Recipe delegation cards */}
            <div className="space-y-3">
              {RECIPES.map((recipe) => {
                const lifecycle = activeRecipes[recipe.id];
                const status = lifecycle?.status ?? 'inactive';
                const isPaused = status === 'paused';
                const isRevoked = status === 'revoked';
                const statusConfig = {
                  active:   { dot: 'bg-success animate-pulse', text: 'text-success',  bg: 'rgba(111,207,151,0.08)',  border: 'rgba(111,207,151,0.20)' },
                  paused:   { dot: 'bg-warning',               text: 'text-warning',  bg: 'rgba(242,153,74,0.08)',   border: 'rgba(242,153,74,0.20)' },
                  revoked:  { dot: 'bg-danger',                text: 'text-danger',   bg: 'rgba(235,87,87,0.06)',    border: 'rgba(235,87,87,0.15)' },
                  inactive: { dot: 'bg-subtle',                text: 'text-muted',    bg: 'var(--surface-inner)',    border: 'var(--border)' },
                }[status] ?? { dot: 'bg-subtle', text: 'text-muted', bg: 'var(--surface-inner)', border: 'var(--border)' };
                const isDisabled = !lifecycle || isRevoked || isUpdatingDelegation || isActivating || !keeperSessionKeyAddress;

                return (
                  <div key={recipe.id} className="rounded-xl p-4" style={{ background: statusConfig.bg, border: `1px solid ${statusConfig.border}` }}>
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                      {/* Left: info */}
                      <div className="min-w-0 space-y-2">
                        {/* Name + status badge */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>
                            {recipe.recipeType === 'AUTO_COMPOUNDER' ? t('recipeAutoCompounderName') : t('recipeDcaName')}
                          </span>
                          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusConfig.text}`}
                            style={{ borderColor: statusConfig.border, background: 'transparent' }}>
                            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${statusConfig.dot}`} />
                            {status.toUpperCase()}
                          </span>
                          {lifecycle?.txLifecycleStatus && lifecycle.txLifecycleStatus !== 'idle' && (
                            <span className="mono rounded border px-1.5 py-0.5 text-[10px]" style={{ borderColor: 'var(--border)', color: 'var(--subtle)', background: 'var(--surface-inner)' }}>
                              {lifecycle.txLifecycleStatus.toUpperCase()}
                            </span>
                          )}
                        </div>

                        {/* Meta row */}
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono" style={{ color: 'var(--muted)' }}>
                          {lifecycle && (
                            <span className="flex items-center gap-1">
                              <Clock3 className="h-3 w-3" />
                              {t('expires')}: {new Date(lifecycle.validUntil).toLocaleDateString(locale)}
                            </span>
                          )}
                          {lifecycle?.checkIntervalHours && (
                            <span>
                              ↻ {lifecycle.checkIntervalHours}h{lifecycle.intervalPreset ? ` (${lifecycle.intervalPreset})` : ''}
                            </span>
                          )}
                        </div>

                        {/* Tx hash */}
                        {lifecycle?.txHash && (
                          <a href={`https://testnet.arcscan.app/tx/${lifecycle.txHash}`}
                            target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-mono hover:underline"
                            style={{ color: 'var(--accent)' }}>
                            {lifecycle.txHash.slice(0, 14)}…{lifecycle.txHash.slice(-6)}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        {lifecycle && !lifecycle.txHash && (
                          <span className="text-[11px]" style={{ color: 'var(--success)' }}>{t('restoredWithoutTx')}</span>
                        )}
                        {!lifecycle && (
                          <span className="text-[11px]" style={{ color: 'var(--subtle)' }}>{t('sessionQuotaPerRecipeHint')}</span>
                        )}
                      </div>

                      {/* Right: action buttons */}
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={async () => { await handlePauseRecipe(recipe.id); }}
                          disabled={isDisabled}
                          title={isPaused ? t('resume') : t('pause')}
                          className="flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{
                            borderColor: isPaused ? 'rgba(111,207,151,0.35)' : 'rgba(242,153,74,0.35)',
                            background: isPaused ? 'rgba(111,207,151,0.08)' : 'rgba(242,153,74,0.08)',
                            color: isPaused ? 'var(--success)' : 'var(--warning)',
                          }}
                        >
                          {isUpdatingDelegation ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : isPaused ? (
                            <><Play className="h-3.5 w-3.5" />{t('resume')}</>
                          ) : (
                            <><Pause className="h-3.5 w-3.5" />{t('pause')}</>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={async () => { await handleRevokeRecipe(recipe.id); }}
                          disabled={isDisabled}
                          title={t('revoke')}
                          className="flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{ borderColor: 'rgba(235,87,87,0.35)', background: 'rgba(235,87,87,0.08)', color: 'var(--danger)' }}
                        >
                          {isUpdatingDelegation ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <><Trash2 className="h-3.5 w-3.5" />{t('revoke')}</>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Portfolio Tracker & Execution Audit Log */}
        <PortfolioTracker />
      </main>

      {/* Pre-flight Simulation Modal */}
      <SimulationModal
        isOpen={selectedRecipe !== null}
        recipe={selectedRecipe}
        onClose={() => setSelectedRecipe(null)}
        onCheckDcaAllowance={async (payload) => {
          if (!address || !isAddress(address)) {
            throw new Error('Connect wallet first to run allowance precheck.');
          }

          return precheckDcaAllowance({
            userAddress: address,
            maxSlippageBps: payload.maxSlippageBps,
            totalDcaBudgetUsdc: payload.dcaConfig.totalDcaBudgetUsdc,
            perExecutionUsdc: payload.dcaConfig.perExecutionUsdc,
            targetAssetSymbol: payload.targetAssetSymbol,
          });
        }}
        connectedAddress={address && isAddress(address) ? address : null}
        onConfirm={handleConfirmSimulation}
        isConfirming={isActivating || isUpdatingDelegation}
      />

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-sm sm:px-5" style={{ background: 'var(--nav-bg-solid)', borderColor: 'var(--border)', color: 'var(--ink-2)', boxShadow: 'inset 0 1px 0 var(--border)' }}>
        <span className="flex items-center gap-2">
          <span className="display text-xs font-semibold tracking-tight" style={{ color: 'var(--accent)' }}>DeFi Recipes</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>© 2026</span>
        </span>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <span className="rounded-full border px-2 py-0.5 text-xs font-semibold" style={{ background: 'var(--surface-muted)', color: 'var(--ink)', borderColor: 'var(--border-strong)' }}>{APP_VERSION}</span>
          {footerLinks.map((link) => (
            <a
              key={link.id}
              className="inline-flex items-center gap-1 rounded-md border border-transparent px-1.5 py-1 text-xs transition"
              style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', borderColor: 'transparent' }}
              onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--border-strong)'; (e.currentTarget as HTMLAnchorElement).style.color = 'var(--ink)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'transparent'; (e.currentTarget as HTMLAnchorElement).style.color = 'var(--ink-2)'; }}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              title={link.label}
              aria-label={link.label}
            >
              <FooterLinkIcon id={link.id} className="h-3.5 w-3.5" />
              <span>{link.label}</span>
            </a>
          ))}
        </div>
      </footer>
    </div>
  );
}
