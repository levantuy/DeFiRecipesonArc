'use client';

import React, { useState } from 'react';
import { Navbar } from '@/components/Navbar';
import { RecipeCatalog, RECIPES } from '@/components/RecipeCatalog';
import { SimulationModal, RecipeConfig } from '@/components/SimulationModal';
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

const DEFAULT_MAX_USDC_SPEND_PER_TX = '500';
const DCA_USDC_SPENDER = '0xf992efcb5fa2ed7cb48310d9dd8cb4ce5fb7ddc9' as const;
const DCA_USDC_PROXY_SPENDER = '0xc06ebbefd94032b85424d51906e2a335efae264b' as const;
const DCA_USDC_ALLOWANCE_SPENDERS = [DCA_USDC_SPENDER, DCA_USDC_PROXY_SPENDER] as const;
const DEFAULT_SESSION_VALIDITY_MS = 30 * 24 * 60 * 60 * 1000;
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

interface FrontendPerformanceMetrics {
  timeToSubmittedMs: number[];
  timeToConfirmedMs: number[];
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

export default function Home() {
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
  const keeperSessionKeyAddressRaw = (process.env.NEXT_PUBLIC_KEEPER_SESSION_KEY_ADDRESS || '').trim();
  const keeperSessionKeyAddress = isAddress(keeperSessionKeyAddressRaw)
    ? keeperSessionKeyAddressRaw
    : null;
  const configErrorMessage = keeperSessionKeyAddress
    ? ''
    : 'Missing NEXT_PUBLIC_KEEPER_SESSION_KEY_ADDRESS in web/.env. Production delegation is blocked until this value is configured and dev server restarted.';

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

  const ensureWalletReady = async () => {
    if (!isConnected || !address) {
      throw new Error('Please connect a wallet before updating delegation.');
    }
    if (!keeperSessionKeyAddress) {
      throw new Error(configErrorMessage);
    }
    if (address.toLowerCase() === keeperSessionKeyAddress.toLowerCase()) {
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
    return { connectedAddress: address, keeperSessionKeyAddress };
  };

  const ensureSessionKeyDelegation = async (
    connectedAddress: `0x${string}`,
    configuredKeeperSessionKeyAddress: `0x${string}`
  ): Promise<DelegationSetupResult> => {
    if (!publicClient) {
      throw new Error('Public client is not ready yet. Please wait a moment and retry.');
    }

    const isAlreadyValid = await publicClient.readContract({
      address: CONTRACT_ADDRESSES.sessionKeyRegistry,
      abi: SESSION_KEY_REGISTRY_ABI,
      functionName: 'isValidSessionKey',
      args: [connectedAddress, configuredKeeperSessionKeyAddress],
    });

    if (isAlreadyValid) {
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
        address: CONTRACT_ADDRESSES.sessionKeyRegistry,
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
    executionMode: DcaExecutionMode
  ): Promise<void> => {
    if (!publicClient) {
      throw new Error('Public client is not ready yet. Please wait a moment and retry.');
    }

    for (const spender of DCA_USDC_ALLOWANCE_SPENDERS) {
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
    };
  }) => {
    if (!selectedRecipe || isActivating) return;

    setIsActivating(true);

    try {
      enforceActionCooldown();
      const { connectedAddress, keeperSessionKeyAddress: configuredKeeperSessionKeyAddress } = await ensureWalletReady();
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

        await ensureDcaUsdcAllowance(
          connectedAddress,
          parsedDcaConfig.totalDcaBudgetBaseUnits,
          parsedDcaConfig.executionMode
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
        configuredKeeperSessionKeyAddress
      );

      const selectedRecipeDefinition = RECIPES.find((recipe) => recipe.id === selectedRecipeSnapshot.id);
      const checkIntervalHours = selectedRecipeDefinition?.defaultIntervalHours || 24;

      await syncKeeperRecipe({
        action: 'register',
        userAddress: connectedAddress,
        recipeType: selectedRecipeSnapshot.recipeType,
        recipeName: selectedRecipeSnapshot.name,
        ...(selectedRecipeSnapshot.targetProtocolAddress
          ? { targetProtocolAddress: selectedRecipeSnapshot.targetProtocolAddress }
          : {}),
        ...(selectedRecipeSnapshot.swapProvider
          ? { swapProvider: selectedRecipeSnapshot.swapProvider }
          : {}),
        maxSlippageBps,
        maxUsdcSpendLimit: DEFAULT_MAX_USDC_SPEND_PER_TX,
        parametersJson: {
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
        const nextStatus: RecipeLifecycleStatus = willPause ? 'paused' : 'active';
        const updatedEntries = Object.entries(previous).map(([id, state]) => {
          if (state.status === 'revoked') {
            return [id, state] as const;
          }
          return [id, { ...state, status: nextStatus, txLifecycleStatus: 'submitted' as TxLifecycleStatus, txHash }] as const;
        });
        return Object.fromEntries(updatedEntries);
      });

      let keeperSyncWarning = '';
      try {
        await syncKeeperRecipe({
          action: 'status',
          userAddress: connectedAddress,
          recipeType: currentRecipe.recipeType,
          status: willPause ? 'PAUSED' : 'ACTIVE',
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
      const { connectedAddress, keeperSessionKeyAddress: configuredKeeperSessionKeyAddress } = await ensureWalletReady();
      const submittedAtMs = Date.now();
      const txHash = await sendContractWithRetry(
        {
          address: CONTRACT_ADDRESSES.sessionKeyRegistry,
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
        const updatedEntries = Object.entries(previous).map(([id, state]) => [
          id,
          {
            ...state,
            status: 'revoked' as RecipeLifecycleStatus,
            txLifecycleStatus: 'submitted' as TxLifecycleStatus,
            txHash,
          },
        ] as const);
        return Object.fromEntries(updatedEntries);
      });

      let keeperSyncWarning = '';
      try {
        await syncKeeperRecipe({
          action: 'status',
          userAddress: connectedAddress,
          recipeType: currentRecipe.recipeType,
          status: 'CANCELLED',
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
              <span>Lean Core Execution &amp; Security Focus (v2.1)</span>
            </div>

            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight">
              Automate Your Yield on Arc Network with <span className="gradient-text">Zero Compromises</span>
            </h1>

            <p className="text-slate-300 text-base leading-relaxed">
              DeFi Recipes delivers audited, non-custodial financial automation workflows. Enjoy sub-second finality, transparent static simulation via <code>eth_call</code>, and native USDC gas predictability.
            </p>

            <div className="flex flex-wrap gap-4 pt-2 text-xs font-mono text-slate-400">
              <div className="flex items-center space-x-1.5">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                <span>Audited SharedExecutorProxy</span>
              </div>
              <div className="flex items-center space-x-1.5">
                <Cpu className="h-4 w-4 text-blue-400" />
                <span>Viem v2 Pre-Flight Simulation</span>
              </div>
            </div>
          </div>
        </div>

        {/* Recipe Catalog */}
        <RecipeCatalog onSelectRecipe={(recipe) => setSelectedRecipe(recipe)} />

        <section className="glass-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-white">Active Delegations</h2>
            <span className="text-xs text-slate-400 font-mono">1-click pause/revoke</span>
          </div>

          {configErrorMessage ? (
            <p className="text-sm text-rose-300 bg-rose-950/30 border border-rose-800/60 rounded-lg px-3 py-2">
              {configErrorMessage}
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
                    <div className="text-white font-semibold">{recipe.name}</div>
                    <div className="text-xs text-slate-400">
                      Status: <span className="font-mono text-slate-200 uppercase">{status}</span>
                    </div>
                    {lifecycle ? (
                      <div className="text-xs text-slate-400">
                        Tx Lifecycle: <span className="font-mono text-slate-200 uppercase">{lifecycle.txLifecycleStatus}</span>
                      </div>
                    ) : null}
                    {lifecycle ? (
                      <div className="text-xs text-slate-400">
                        Expires: <span className="font-mono text-slate-200">{new Date(lifecycle.validUntil).toLocaleString()}</span>
                      </div>
                    ) : null}
                    {lifecycle ? (
                      <div className="text-xs text-slate-400">
                        Per-Tx Cap: <span className="font-mono text-slate-200">{lifecycle.maxUsdcSpendPerTx}</span>
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
                        Delegation already existed. No new registration tx needed.
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
                      {isUpdatingDelegation ? 'Submitting...' : status === 'paused' ? 'Resume' : 'Pause'}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await handleRevokeRecipe(recipe.id);
                      }}
                      disabled={!lifecycle || status === 'revoked' || isUpdatingDelegation || isActivating || !keeperSessionKeyAddress}
                      className="px-3 py-1.5 rounded-lg bg-rose-700/80 hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed text-xs text-white"
                    >
                      {isUpdatingDelegation ? 'Submitting...' : 'Revoke'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="glass-card p-4 text-xs text-slate-300 space-y-1">
          <div className="font-semibold text-slate-100">Wallet Flow Performance (local session)</div>
          <div>
            Time to submitted p95:{' '}
            <span className="font-mono text-slate-100">
              {toP95(frontendMetrics.timeToSubmittedMs) !== null
                ? `${toP95(frontendMetrics.timeToSubmittedMs)}ms`
                : 'N/A'}
            </span>
          </div>
          <div>
            Time to confirmed p95:{' '}
            <span className="font-mono text-slate-100">
              {toP95(frontendMetrics.timeToConfirmedMs) !== null
                ? `${toP95(frontendMetrics.timeToConfirmedMs)}ms`
                : 'N/A'}
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
        onConfirm={handleConfirmSimulation}
        isConfirming={isActivating || isUpdatingDelegation}
      />

      <footer className="border-t border-slate-800/80 py-6 text-center text-xs text-slate-500 font-mono">
        DeFi Recipes on Arc &bull; Community-built for Arc Network (Chain ID: 5042002)
      </footer>
    </div>
  );
}
