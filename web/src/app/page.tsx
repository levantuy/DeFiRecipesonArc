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
import { ShieldCheck, Sparkles, Cpu } from 'lucide-react';
import { parseUnits } from 'viem';
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi';
import { useLanguage } from '@/lib/i18n/LanguageProvider';
import { FooterLinkIcon } from './layout-icons';
import { APP_VERSION, footerLinks } from './layout-config';

const DEFAULT_MAX_USDC_SPEND_PER_TX = '500';
const DCA_USDC_SPENDER = '0xf992efcb5fa2ed7cb48310d9dd8cb4ce5fb7ddc9' as const;
const DCA_USDC_PROXY_SPENDER = '0xc06ebbefd94032b85424d51906e2a335efae264b' as const;
const DCA_USDC_ALLOWANCE_SPENDERS = [DCA_USDC_SPENDER, DCA_USDC_PROXY_SPENDER] as const;
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
  maxUsdcSpendPerTx: string;
  validUntil: string;
  txHash: `0x${string}` | null;
}

interface DelegationSetupResult {
  txHash: `0x${string}` | null;
  alreadyValid: boolean;
  submittedAtMs: number | null;
}

interface WalletReadyContext {
  connectedAddress: `0x${string}`;
  keeperSessionKeyAddress: `0x${string}`;
  sessionKeyRegistryAddress: `0x${string}`;
}

interface FrontendPerformanceMetrics {
  timeToSubmittedMs: number[];
  timeToConfirmedMs: number[];
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

interface PersistedActiveRecipeApiItem {
  id?: string;
  userAddress?: string;
  recipeType?: string;
  status?: string;
  maxSlippageBps?: number;
  maxUsdcSpendLimit?: string;
  delegationTxHash?: string | null;
  delegationValidUntil?: string | null;
  createdAt?: string;
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

export default function Home() {
  const { lang, t } = useLanguage();
  const locale = lang === 'vi' ? 'vi-VN' : 'en-US';
  const [selectedRecipe, setSelectedRecipe] = useState<RecipeConfig | null>(null);
  const [activeRecipes, setActiveRecipes] = useState<Record<string, ActiveRecipeState>>({});
  const [feedbackMessage, setFeedbackMessage] = useState<string>('');
  const [isActivating, setIsActivating] = useState(false);
  const [isUpdatingDelegation, setIsUpdatingDelegation] = useState(false);
  const [lastActionAt, setLastActionAt] = useState<number>(0);
  const [frontendMetrics, setFrontendMetrics] = useState<FrontendPerformanceMetrics>({
    timeToSubmittedMs: [],
    timeToConfirmedMs: [],
  });
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
            maxUsdcSpendPerTx: `${recipe.maxUsdcSpendLimit || DEFAULT_MAX_USDC_SPEND_PER_TX} USDC`,
            validUntil: recipe.delegationValidUntil || recipe.createdAt || new Date().toISOString(),
            txHash: recipe.delegationTxHash && /^0x[a-fA-F0-9]{64}$/.test(recipe.delegationTxHash)
              ? recipe.delegationTxHash as `0x${string}`
              : null,
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

  const pushFrontendMetric = (field: keyof FrontendPerformanceMetrics, valueMs: number) => {
    setFrontendMetrics((previous) => {
      const nextSeries = [...previous[field], valueMs].slice(-50);
      return {
        ...previous,
        [field]: nextSeries,
      };
    });
  };

  const toP95 = (values: number[]): number | null => {
    if (values.length === 0) {
      return null;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
    return sorted[index];
  };

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
    sessionKeyRegistryAddress: `0x${string}`
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

    if (isActive && hasSpendHeadroom) {
      return {
        txHash: null,
        alreadyValid: true,
        submittedAtMs: null,
      };
    }

    const validUntilMs = Date.now() + DEFAULT_SESSION_VALIDITY_MS;
    const validUntilSeconds = BigInt(Math.floor(validUntilMs / 1000));
    const maxUsdcSpendLimit = parseUnits(DEFAULT_MAX_USDC_SPEND_PER_TX, 6);

    const submittedAtMs = Date.now();
    const txHash = await sendContractWithRetry(
      {
        address: sessionKeyRegistryAddress,
        abi: SESSION_KEY_REGISTRY_ABI,
        functionName: 'registerSessionKey',
        args: [configuredKeeperSessionKeyAddress, validUntilSeconds, maxUsdcSpendLimit],
        chainId: ARC_TESTNET_CHAIN_ID,
      },
      {
        onRetry: (attempt, maxAttempts) => {
          setFeedbackMessage(`Arc RPC is busy. Retrying transaction submission (${attempt}/${maxAttempts - 1})...`);
        },
      }
    );

    pushFrontendMetric('timeToSubmittedMs', Date.now() - submittedAtMs);

    return {
      txHash,
      alreadyValid: false,
      submittedAtMs,
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

  const trackConfirmationInBackground = (
    hash: `0x${string}`,
    startedAtMs: number,
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
        pushFrontendMetric('timeToConfirmedMs', Date.now() - startedAtMs);
        onConfirmed();
        return;
      }

      onTimeout();

      for (let round = 1; round <= TX_CONFIRM_BACKGROUND_MAX_ROUNDS; round += 1) {
        await sleep(TX_CONFIRM_BACKGROUND_DELAY_MS);
        const confirmed = await waitForReceiptWithTimeout(hash, TX_CONFIRM_TIMEOUT_MS);
        if (confirmed) {
          pushFrontendMetric('timeToConfirmedMs', Date.now() - startedAtMs);
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
    executionMode: DcaExecutionMode,
    extraSpenders?: readonly `0x${string}`[]
  ): Promise<void> => {
    if (!publicClient) {
      throw new Error('Public client is not ready yet. Please wait a moment and retry.');
    }

    const spenders = Array.from(
      new Set(
        [...DCA_USDC_ALLOWANCE_SPENDERS, ...(extraSpenders || [])].map((spender) => spender.toLowerCase())
      )
    ) as `0x${string}`[];

    for (const spender of spenders) {
      const currentAllowance = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.usdc,
        abi: ERC20_ALLOWANCE_AND_APPROVE_ABI,
        functionName: 'allowance',
        args: [connectedAddress, spender],
      });

      if (currentAllowance >= requiredAllowanceBaseUnits) {
        continue;
      }

      setFeedbackMessage(
        `USDC allowance is below required DCA ${executionMode === 'PREFUND' ? 'prefund' : 'pull'} budget. ` +
        `Approving spender ${spender} for ${requiredAllowanceBaseUnits.toString()} base units...`
      );

      const submittedAtMs = Date.now();
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

      pushFrontendMetric('timeToSubmittedMs', Date.now() - submittedAtMs);

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
    }
  };

  const handleConfirmSimulation = async ({
    maxSlippageBps,
    dcaConfig,
  }: {
    maxSlippageBps: number;
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

        if (parsedDcaConfig.executionMode !== 'PULL') {
          throw new Error(
            'DCA PREFUND mode is not supported by the current on-chain execution path yet. ' +
            'Please switch to PULL mode and retry activation.'
          );
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

        await ensureDcaUsdcAllowance(
          connectedAddress,
          parsedDcaConfig.totalDcaBudgetBaseUnits,
          parsedDcaConfig.executionMode,
          runtimeRequiredSpenders.length > 0
            ? runtimeRequiredSpenders
            : runtimeSpender
              ? [runtimeSpender, CONTRACT_ADDRESSES.sharedExecutorProxy]
              : [CONTRACT_ADDRESSES.sharedExecutorProxy]
        );

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
        sessionKeyRegistryAddress
      );

      const selectedRecipeDefinition = RECIPES.find((recipe) => recipe.id === selectedRecipeSnapshot.id);
      const checkIntervalHours = selectedRecipeDefinition?.defaultIntervalHours || 24;

      await syncKeeperRecipe({
        action: 'register',
        userAddress: connectedAddress,
        recipeType: selectedRecipeSnapshot.recipeType,
        recipeName: selectedRecipeSnapshot.name,
        txHash: delegationResult.txHash,
        ...(selectedRecipeSnapshot.targetProtocolAddress
          ? { targetProtocolAddress: selectedRecipeSnapshot.targetProtocolAddress }
          : {}),
        ...(selectedRecipeSnapshot.swapProvider
          ? { swapProvider: selectedRecipeSnapshot.swapProvider }
          : {}),
        maxSlippageBps,
        maxUsdcSpendLimit: DEFAULT_MAX_USDC_SPEND_PER_TX,
        parametersJson: {
          delegationValidUntil: validUntil,
          checkIntervalHours,
          maxSlippageBps,
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
          maxUsdcSpendPerTx: `${DEFAULT_MAX_USDC_SPEND_PER_TX} USDC`,
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
            `${normalizedDcaPayload.perExecutionUsdc} USDC per run, mode ${normalizedDcaPayload.executionMode === 'PREFUND' ? 'PREFUND' : 'PULL_PER_RUN'}. `
          : '';

      setFeedbackMessage(
        `${selectedRecipeSnapshot.name} activated. ${dcaMessage}${delegationMessage}`
      );

      if (delegationResult.txHash && delegationResult.submittedAtMs) {
        trackConfirmationInBackground(
          delegationResult.txHash,
          delegationResult.submittedAtMs,
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
      const submittedAtMs = Date.now();
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
      pushFrontendMetric('timeToSubmittedMs', Date.now() - submittedAtMs);

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

      trackConfirmationInBackground(
        txHash,
        submittedAtMs,
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

      const submittedAtMs = Date.now();
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
      pushFrontendMetric('timeToSubmittedMs', Date.now() - submittedAtMs);

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

      trackConfirmationInBackground(
        txHash,
        submittedAtMs,
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

            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight">
              {t('heroTitle')} <span className="gradient-text">{t('heroTitleAccent')}</span>
            </h1>

            <p className="text-slate-300 text-base leading-relaxed">
              {t('heroDescription')}
            </p>

            <div className="flex flex-wrap gap-4 pt-2 text-xs font-mono text-slate-400">
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

        <section className="glass-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-white">{t('activeDelegations')}</h2>
            <div className="text-right space-y-1">
              <span className="block text-xs text-slate-400 font-mono">{t('pauseRevoke')}</span>
              <span className="block text-[11px] font-mono text-slate-500">
                {t('dataSource')}: {delegationDataSource === 'keeper-db' ? t('keeperDb') : delegationDataSource === 'memory-fallback' ? t('memoryFallback') : t('unknown')}
              </span>
            </div>
          </div>

          {configErrorMessage ? (
            <p className="text-sm text-rose-300 bg-rose-950/30 border border-rose-800/60 rounded-lg px-3 py-2">
              {configErrorMessage}
            </p>
          ) : null}

          {keeperAddressSyncWarning ? (
            <p className="text-sm text-amber-200 bg-amber-950/30 border border-amber-800/60 rounded-lg px-3 py-2">
              {keeperAddressSyncWarning}
            </p>
          ) : null}

          <div className="text-xs text-slate-300 bg-slate-950/40 border border-slate-800 rounded-lg px-3 py-2 space-y-1">
            <div className="uppercase tracking-wider text-[11px] text-slate-400">{t('runtimeRouting')}</div>
            <div>
              {t('sessionKeyInUse')}:{' '}
              <a
                href={`https://testnet.arcscan.app/address/${runtimeSessionKeyRegistryAddress || CONTRACT_ADDRESSES.sessionKeyRegistry}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-blue-400 hover:underline break-all"
              >
                {runtimeSessionKeyRegistryAddress || CONTRACT_ADDRESSES.sessionKeyRegistry}
              </a>
            </div>
            <div className="text-[11px] text-slate-500">
              {t('source')}:{' '}
              {runtimeSessionKeyRegistryAddress
                ? t('runtimeResolution')
                : t('configFallback')}
            </div>
          </div>

          {sessionKeyRegistrySyncWarning ? (
            <p className="text-sm text-amber-200 bg-amber-950/30 border border-amber-800/60 rounded-lg px-3 py-2">
              {sessionKeyRegistrySyncWarning}
            </p>
          ) : null}

          {feedbackMessage ? (
            <p className="text-sm text-blue-300 bg-blue-950/30 border border-blue-800/60 rounded-lg px-3 py-2">
              {feedbackMessage}
            </p>
          ) : null}

          <div className="space-y-3">
            {RECIPES.map((recipe) => {
              const lifecycle = activeRecipes[recipe.id];
              const status = lifecycle?.status ?? 'inactive';
              return (
                <div
                  key={recipe.id}
                  className="border border-slate-800 bg-slate-900/60 rounded-xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="text-white font-semibold">{recipe.recipeType === 'AUTO_COMPOUNDER' ? t('recipeAutoCompounderName') : t('recipeDcaName')}</div>
                    <div className="text-xs text-slate-400">
                      {t('status')}: <span className="font-mono text-slate-200 uppercase">{status}</span>
                    </div>
                    {lifecycle ? (
                      <div className="text-xs text-slate-400">
                        {t('txLifecycle')}: <span className="font-mono text-slate-200 uppercase">{lifecycle.txLifecycleStatus}</span>
                      </div>
                    ) : null}
                    {lifecycle ? (
                      <div className="text-xs text-slate-400">
                        {t('expires')}: <span className="font-mono text-slate-200">{new Date(lifecycle.validUntil).toLocaleString(locale)}</span>
                      </div>
                    ) : null}
                    {lifecycle ? (
                      <div className="text-xs text-slate-400">
                        {t('perTxCap')}: <span className="font-mono text-slate-200">{lifecycle.maxUsdcSpendPerTx}</span>
                      </div>
                    ) : null}
                    {lifecycle?.txHash ? (
                      <a
                        href={`https://testnet.arcscan.app/tx/${lifecycle.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-400 hover:underline break-all"
                      >
                        {lifecycle.txHash}
                      </a>
                    ) : null}
                    {lifecycle && !lifecycle.txHash ? (
                      <div className="text-xs text-emerald-300">
                        {t('restoredWithoutTx')}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await handlePauseRecipe(recipe.id);
                      }}
                      disabled={!lifecycle || status === 'revoked' || isUpdatingDelegation || isActivating || !keeperSessionKeyAddress}
                      className="px-3 py-1.5 rounded-lg bg-amber-600/80 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-xs text-white"
                    >
                      {isUpdatingDelegation ? t('submitting') : status === 'paused' ? t('resume') : t('pause')}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await handleRevokeRecipe(recipe.id);
                      }}
                      disabled={!lifecycle || status === 'revoked' || isUpdatingDelegation || isActivating || !keeperSessionKeyAddress}
                      className="px-3 py-1.5 rounded-lg bg-rose-700/80 hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed text-xs text-white"
                    >
                      {isUpdatingDelegation ? t('submitting') : t('revoke')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="glass-card p-4 text-xs text-slate-300 space-y-1">
          <div className="font-semibold text-slate-100">{t('walletPerformance')}</div>
          <div>
            {t('timeToSubmitted')}:{' '}
            <span className="font-mono text-slate-100">
              {toP95(frontendMetrics.timeToSubmittedMs) !== null
                ? `${toP95(frontendMetrics.timeToSubmittedMs)}ms`
                : t('notAvailable')}
            </span>
          </div>
          <div>
            {t('timeToConfirmed')}:{' '}
            <span className="font-mono text-slate-100">
              {toP95(frontendMetrics.timeToConfirmedMs) !== null
                ? `${toP95(frontendMetrics.timeToConfirmedMs)}ms`
                : t('notAvailable')}
            </span>
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

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface/80 px-4 py-2 text-sm text-muted sm:px-5">
        <span>© 2026 Defi Recipes. All rights reserved.</span>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <span className="rounded-full border border-border px-2 py-0.5 text-xs font-semibold text-muted">{APP_VERSION}</span>
          {footerLinks.map((link) => (
            <a
              key={link.id}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted transition hover:bg-surface-alt hover:text-primary"
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
