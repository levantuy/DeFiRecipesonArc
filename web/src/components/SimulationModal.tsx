'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertTriangle, ArrowRight, ShieldAlert, X, CheckCheck, Loader2, Key } from 'lucide-react';
import { useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi';
import { maxUint256 } from 'viem';
import {
  DcaExecutionMode,
  estimateDcaRuns,
  formatUsdcBaseUnits,
  parseDcaActivationConfig,
  parseUsdcAmountToBaseUnits,
} from '@/lib/dcaConfig';
import { useLanguage } from '@/lib/i18n/LanguageProvider';
import { en } from '@/lib/i18n/en';
import { vi } from '@/lib/i18n/vi';
import { parseIntervalHours } from '@/lib/intervalConfig';

export type RecipeType = 'AUTO_COMPOUNDER' | 'RECURRING_DCA';
export type SwapProvider = 'ARC_APP_KIT_SWAP' | 'ARC_LIFI_SWAP' | 'LIFI_DIRECT' | 'CURVE_DIRECT' | 'CIRCLE_DIRECT';
export type IntervalPreset = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';

export const SWAP_PROVIDER_OPTIONS: { value: SwapProvider; label: string; description: string }[] = [
  {
    value: 'CURVE_DIRECT',
    label: 'Curve Direct (Recommended)',
    description: 'Calls Curve USDC/EURC pool directly. No external API dependency — most reliable on Arc Testnet.',
  },
  {
    value: 'ARC_APP_KIT_SWAP',
    label: 'Arc App Kit Swap',
    description: 'Circle Stablecoin Service via ArcSwapAdapter. Requires testnet liquidity.',
  },
  {
    value: 'ARC_LIFI_SWAP',
    label: 'LI.FI via Arc App Kit',
    description: 'Uses @lifi/sdk with Arc Testnet chain registration. Intermittent on testnet.',
  },
  {
    value: 'LIFI_DIRECT',
    label: 'LI.FI Direct REST',
    description: 'LI.FI REST /v1/quote without SDK. Intermittent on testnet.',
  },
  {
    value: 'CIRCLE_DIRECT',
    label: 'Circle Direct',
    description: 'Circle Stablecoin Service REST API without Arc SDK adapter.',
  },
];

export interface RecipeConfig {
  id: string;
  recipeType: RecipeType;
  name: string;
  targetProtocol: string;
  targetProtocolAddress?: `0x${string}`;
  swapProvider?: SwapProvider;
  targetAssetSymbol?: 'USDC' | 'EURC' | 'cirBTC';
  totalDcaBudgetUsdc?: string;
  perExecutionUsdc?: string;
  executionMode?: DcaExecutionMode;
  maxSlippageBps: number;
  estimatedGasUsdc: string;
  expectedNetApy: string;
  riskWarning: string;
  routeSteps: string[];
  defaultIntervalHours?: number;
}

export interface RecipeActivationConfig {
  intervalHours: number;
  intervalPreset: IntervalPreset;
}

export interface DcaAllowancePrecheckResult {
  runtimeSpender: `0x${string}`;
  targetProtocolAddress: `0x${string}`;
  callDataSelector: `0x${string}`;
  targetAssetSymbol: string;
  maxSlippageBps: number;
  currentAllowanceBaseUnits: string;
  requiredForSchedulerBaseUnits: string;
  requiredForActivationBaseUnits: string;
  requiredSpenders?: `0x${string}`[];
  allowanceBySpender?: Record<string, string>;
  isEnoughForScheduler: boolean;
  isEnoughForActivation: boolean;
  checkedAt: string;
}

const DCA_DEFAULT_TOTAL_BUDGET_USDC = '50';
const DCA_DEFAULT_PER_EXECUTION_USDC = '5';
const SHARED_EXECUTOR_PROXY_SPENDER = '0xcbd2de404cb02c45b8688883e4321f887a6f2fc2';
export const DEFAULT_SESSION_SPEND_LIMIT_USDC = '500';

// SessionKeyRegistry constants (Arc Testnet)
const SESSION_KEY_REGISTRY = '0x8dA092254Fe83DeC49Cde856b2b68eB2BFb12ed9' as const;
const KEEPER_EOA = '0xecd06D7a0191f74B9C1Fe007e02eD0B8ef32E866' as const;
const SESSION_KEY_DEFAULT_DAYS = 365;

const SESSION_KEY_REGISTRY_ABI = [
  {
    name: 'isValidSessionKey',
    type: 'function' as const,
    inputs: [{ name: 'user', type: 'address' }, { name: 'keeper', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view' as const,
  },
  {
    name: 'registerSessionKey',
    type: 'function' as const,
    inputs: [
      { name: 'keeper', type: 'address' },
      { name: 'validUntil', type: 'uint64' },
      { name: 'maxSpendLimit', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable' as const,
  },
] as const;

interface SimulationModalProps {
  isOpen: boolean;
  recipe: RecipeConfig | null;
  onClose: () => void;
  onConfirm: (payload: {
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
  }) => Promise<void> | void;
  onCheckDcaAllowance?: (payload: {
    maxSlippageBps: number;
    dcaConfig: {
      totalDcaBudgetUsdc: string;
      perExecutionUsdc: string;
      executionMode: DcaExecutionMode;
    };
    targetAssetSymbol?: 'USDC' | 'EURC' | 'cirBTC';
  }) => Promise<DcaAllowancePrecheckResult>;
  connectedAddress?: `0x${string}` | null;
  isConfirming?: boolean;
}

export const SimulationModal: React.FC<SimulationModalProps> = ({
  isOpen,
  recipe,
  onClose,
  onConfirm,
  onCheckDcaAllowance,
  connectedAddress = null,
  isConfirming = false,
}) => {
  const { lang, t } = useLanguage();
  const dictionary = lang === 'vi' ? vi : en;
  const [maxSlippageBps, setMaxSlippageBps] = useState(recipe?.maxSlippageBps ?? 50);
  const [sessionSpendLimitUsdc, setSessionSpendLimitUsdc] = useState(DEFAULT_SESSION_SPEND_LIMIT_USDC);
  const [selectedSwapProvider, setSelectedSwapProvider] = useState<SwapProvider>(
    (recipe?.swapProvider as SwapProvider | undefined) ?? 'CURVE_DIRECT'
  );
  const [totalDcaBudgetUsdc, setTotalDcaBudgetUsdc] = useState(recipe?.totalDcaBudgetUsdc ?? DCA_DEFAULT_TOTAL_BUDGET_USDC);
  const [perExecutionUsdc, setPerExecutionUsdc] = useState(recipe?.perExecutionUsdc ?? DCA_DEFAULT_PER_EXECUTION_USDC);
  const [intervalHours, setIntervalHours] = useState(String(recipe?.defaultIntervalHours ?? 24));
  const [intervalPreset, setIntervalPreset] = useState<IntervalPreset>('CUSTOM');
  const executionMode: DcaExecutionMode = 'PULL';
  const [allowanceCheck, setAllowanceCheck] = useState<DcaAllowancePrecheckResult | null>(null);
  const [allowanceCheckError, setAllowanceCheckError] = useState<string>('');
  const [isCheckingAllowance, setIsCheckingAllowance] = useState(false);
  const [approvingSpender, setApprovingSpender] = useState<string | null>(null);
  const [approvedSpenders, setApprovedSpenders] = useState<Set<string>>(new Set());

  const { writeContract, data: approveTxHash } = useWriteContract();
  const { isLoading: isApproveConfirming, isSuccess: isApproveConfirmed } = useWaitForTransactionReceipt({ hash: approveTxHash });

  // Session key state
  const [registerSessionKeyTxHash, setRegisterSessionKeyTxHash] = useState<`0x${string}` | undefined>(undefined);
  const [isRegisteringSessionKey, setIsRegisteringSessionKey] = useState(false);
  const { writeContract: writeSessionKeyContract, data: sessionKeyTxHash } = useWriteContract();
  const { isLoading: isSessionKeyConfirming, isSuccess: isSessionKeyConfirmed } = useWaitForTransactionReceipt({ hash: registerSessionKeyTxHash });

  // Track sessionKeyTxHash for receipt watching
  useEffect(() => {
    if (sessionKeyTxHash) setRegisterSessionKeyTxHash(sessionKeyTxHash);
  }, [sessionKeyTxHash]);

  // handleRegisterSessionKey — defined here, refetchSessionKey used below after isDcaRecipe
  const handleRegisterSessionKey = () => {
    if (!connectedAddress) return;
    setIsRegisteringSessionKey(true);
    const validUntil = BigInt(Math.floor(Date.now() / 1000) + SESSION_KEY_DEFAULT_DAYS * 86400);
    const maxSpendLimit = BigInt(Math.round(parseFloat(sessionSpendLimitUsdc || DEFAULT_SESSION_SPEND_LIMIT_USDC) * 1_000_000));
    writeSessionKeyContract({
      address: SESSION_KEY_REGISTRY,
      abi: SESSION_KEY_REGISTRY_ABI,
      functionName: 'registerSessionKey',
      args: [KEEPER_EOA, validUntil, maxSpendLimit],
    });
  };

  // After approve confirmed — refresh allowance check and mark spender approved
  useEffect(() => {
    if (isApproveConfirmed && approvingSpender) {
      setApprovedSpenders(prev => new Set([...prev, approvingSpender.toLowerCase()]));
      setApprovingSpender(null);
      // Auto-refresh allowance check
      void runAllowanceCheck();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isApproveConfirmed]);

  const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const;
  const ERC20_APPROVE_ABI = [{
    name: 'approve',
    type: 'function' as const,
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable' as const,
  }] as const;

  const handleApprove = (spender: `0x${string}`, amountBaseUnits: string) => {
    setApprovingSpender(spender.toLowerCase());
    writeContract({
      address: USDC_ADDRESS,
      abi: ERC20_APPROVE_ABI,
      functionName: 'approve',
      args: [spender, maxUint256],
    });
    void amountBaseUnits; // suppress unused warning — we approve maxUint256
  };

  useEffect(() => {
    if (recipe) {
      setMaxSlippageBps(recipe.maxSlippageBps);
      setSessionSpendLimitUsdc(DEFAULT_SESSION_SPEND_LIMIT_USDC);
      setTotalDcaBudgetUsdc(recipe.totalDcaBudgetUsdc ?? DCA_DEFAULT_TOTAL_BUDGET_USDC);
      setPerExecutionUsdc(recipe.perExecutionUsdc ?? DCA_DEFAULT_PER_EXECUTION_USDC);
      setIntervalHours(String(recipe.defaultIntervalHours ?? (recipe.recipeType === 'AUTO_COMPOUNDER' ? 168 : 24)));
      setIntervalPreset('CUSTOM');
      setSelectedSwapProvider((recipe.swapProvider as SwapProvider | undefined) ?? 'CURVE_DIRECT');
      setAllowanceCheck(null);
      setAllowanceCheckError('');
      setIsCheckingAllowance(false);
    }
  }, [recipe]);

  const isDcaRecipe = recipe?.recipeType === 'RECURRING_DCA';

  // Session key read — placed after isDcaRecipe to avoid "used before declaration" error
  const { data: isSessionKeyValid, refetch: refetchSessionKey } = useReadContract({
    address: SESSION_KEY_REGISTRY,
    abi: SESSION_KEY_REGISTRY_ABI,
    functionName: 'isValidSessionKey',
    args: connectedAddress ? [connectedAddress, KEEPER_EOA] : undefined,
    query: { enabled: Boolean(connectedAddress) && isDcaRecipe },
  });

  // After session key confirmed — refetch
  useEffect(() => {
    if (isSessionKeyConfirmed) {
      setIsRegisteringSessionKey(false);
      void refetchSessionKey();
    }
  }, [isSessionKeyConfirmed, refetchSessionKey]);

  let sessionSpendLimitValidationError: string | null = null;
  try {
    parseUsdcAmountToBaseUnits(sessionSpendLimitUsdc, 'Session spending limit');
  } catch (error: unknown) {
    sessionSpendLimitValidationError = error instanceof Error ? error.message : t('invalidDcaConfig');
  }
  let dcaValidationError: string | null = null;
  let estimatedRuns: bigint = 0n;
  let intervalValidationError: string | null = null;
  try {
    parseIntervalHours(intervalHours);
  } catch (error: unknown) {
    intervalValidationError = error instanceof Error ? error.message : 'Invalid interval.';
  }
  let sessionQuotaError: string | null = null;

  if (isDcaRecipe && recipe) {
    try {
      const parsed = parseDcaActivationConfig({
        totalDcaBudgetUsdc,
        perExecutionUsdc,
        executionMode,
      });
      estimatedRuns = estimateDcaRuns(parsed.totalDcaBudgetBaseUnits, parsed.perExecutionBaseUnits);
      if (estimatedRuns <= 0n) {
        dcaValidationError = t('estimatedRunsZero');
      }
      if (Number(sessionSpendLimitUsdc) < Number(totalDcaBudgetUsdc)) {
        sessionQuotaError = 'Session spending limit must be at least the total DCA budget.';
      }
    } catch (error: unknown) {
      dcaValidationError = error instanceof Error ? error.message : t('invalidDcaConfig');
    }
  }

  const runAllowanceCheck = useCallback(async () => {
    if (!recipe || !onCheckDcaAllowance || !isDcaRecipe || executionMode !== 'PULL' || !connectedAddress) {
      return;
    }

    setIsCheckingAllowance(true);
    setAllowanceCheckError('');

    try {
      const result = await onCheckDcaAllowance({
        maxSlippageBps,
        dcaConfig: {
          totalDcaBudgetUsdc: totalDcaBudgetUsdc.trim(),
          perExecutionUsdc: perExecutionUsdc.trim(),
          executionMode,
        },
        targetAssetSymbol: recipe.targetAssetSymbol,
      });
      setAllowanceCheck(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : t('failedToCheckAllowance');
      setAllowanceCheckError(message);
      setAllowanceCheck(null);
    } finally {
      setIsCheckingAllowance(false);
    }
  }, [
    recipe,
    onCheckDcaAllowance,
    isDcaRecipe,
    executionMode,
    connectedAddress,
    maxSlippageBps,
    totalDcaBudgetUsdc,
    perExecutionUsdc,
    t,
  ]);

  useEffect(() => {
    if (!isOpen || !isDcaRecipe || executionMode !== 'PULL' || !connectedAddress || dcaValidationError || !onCheckDcaAllowance) {
      return;
    }

    const timer = setTimeout(() => {
      void runAllowanceCheck();
    }, 500);

    return () => {
      clearTimeout(timer);
    };
  }, [
    isOpen,
    isDcaRecipe,
    executionMode,
    connectedAddress,
    dcaValidationError,
    totalDcaBudgetUsdc,
    perExecutionUsdc,
    maxSlippageBps,
    recipe?.targetAssetSymbol,
    onCheckDcaAllowance,
    runAllowanceCheck,
  ]);

  if (!isOpen || !recipe) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md sm:p-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="glass-modal flex max-h-[calc(100dvh-2rem)] min-h-0 w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-blue-500/30 shadow-2xl"
        >
          <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: 'rgba(111,207,151,0.12)' }}>
                <CheckCircle2 className="h-4 w-4" style={{ color: 'var(--success)' }} />
              </div>
              <div>
                <h3 className="display text-sm font-semibold text-ink">{t('modalTitle')}</h3>
                <p className="text-[11px]" style={{ color: 'var(--subtle)' }}>
                  {recipe.recipeType === 'AUTO_COMPOUNDER' ? t('recipeAutoCompounderName') : t('recipeDcaName')}
                </p>
              </div>
            </div>
            <button type="button" onClick={onClose} disabled={isConfirming}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-40"
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = ''; }}
              style={{ color: 'var(--muted)' }}>
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-4">
            <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-4">
                {/* Swap Provider Selector — shown only for DCA recipe, right at the top */}
                {isDcaRecipe && (
                  <div className="rounded-xl border border-blue-700/50 bg-blue-950/30 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-blue-300">Swap Provider</span>
                      <span className="rounded-full border border-blue-700/60 bg-blue-900/40 px-2 py-0.5 text-[10px] font-mono text-blue-300">
                        {selectedSwapProvider}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      {SWAP_PROVIDER_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setSelectedSwapProvider(opt.value)}
                          className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-all ${
                            selectedSwapProvider === opt.value
                              ? 'border-blue-500 bg-blue-900/50 ring-1 ring-blue-500/30'
                              : 'border-slate-700 bg-slate-900/60 hover:border-slate-500 hover:bg-slate-800/60'
                          }`}
                        >
                          <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                            selectedSwapProvider === opt.value
                              ? 'border-blue-400 bg-blue-400'
                              : 'border-slate-600 bg-transparent'
                          }`}>
                            {selectedSwapProvider === opt.value && (
                              <span className="h-1.5 w-1.5 rounded-full bg-white" />
                            )}
                          </span>
                          <div className="min-w-0">
                            <div className={`text-xs font-semibold ${selectedSwapProvider === opt.value ? 'text-white' : 'text-slate-300'}`}>
                              {opt.label}
                            </div>
                            <div className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                              {opt.description}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2 rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface-muted)' }}>
                  <div className="mb-2 text-xs uppercase tracking-wider font-mono" style={{ color: 'var(--muted)' }}>{t('routingAssetFlow')}</div>
                  <div className="space-y-2">
                    {(recipe.recipeType === 'AUTO_COMPOUNDER' ? dictionary.recipeAutoCompounderSteps : dictionary.recipeDcaSteps).map((step, index) => (
                      <div key={`${recipe.id}-${index}`} className="flex items-center gap-2 text-sm" style={{ color: 'var(--ink-2)' }}>
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-blue-700 bg-blue-900/40 text-[10px] font-bold text-blue-300">
                          {index + 1}
                        </span>
                        <span>{step}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--ink-2)' }}>
                    <span>{t('userWallet')}</span>
                    <ArrowRight className="h-4 w-4 text-emerald-400" />
                    <span>SharedExecutorProxy</span>
                    <ArrowRight className="h-4 w-4 text-emerald-400" />
                    <div className="max-w-[40%] truncate">{recipe.targetProtocol}</div>
                  </div>
                  <div className="mt-1 break-all text-[11px] font-mono" style={{ color: 'var(--subtle)' }}>
                    {t('targetProtocol')}: {recipe.targetProtocolAddress || t('routeResolved')}
                  </div>
                  <div className="mt-1 break-all text-[11px] font-mono" style={{ color: 'var(--subtle)' }}>
                    {t('swapProvider')}: {isDcaRecipe ? selectedSwapProvider : (recipe.swapProvider || t('na'))}
                  </div>
                </div>

                <div className="space-y-3 rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface-muted)' }}>
                  <div className="text-xs uppercase tracking-wider font-mono" style={{ color: 'var(--muted)' }}>{t('parametersProtection')}</div>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs" style={{ color: 'var(--muted)' }}>
                      <span>{t('maxSlippage')}</span>
                      <span className="font-mono text-emerald-400">{(maxSlippageBps / 100).toFixed(2)}%</span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={100}
                      step={5}
                      value={maxSlippageBps}
                      onChange={(event) => setMaxSlippageBps(Number(event.target.value))}
                      className="w-full"
                    />
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs" style={{ color: 'var(--muted)' }}>
                      <span>{t('sessionSpendLimitLabel')}</span>
                    </div>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={sessionSpendLimitUsdc}
                      onChange={(event) => setSessionSpendLimitUsdc(event.target.value)}
                      placeholder={t('sessionSpendLimitPlaceholder')}
                      className="surface-input w-full px-3 py-2 text-sm"
                    />
                    <div className="mt-1 text-[11px]" style={{ color: 'var(--subtle)' }}>{t('sessionSpendLimitHint')}</div>
                    {sessionSpendLimitValidationError ? (
                      <div className="mt-2 rounded-lg border border-rose-800/70 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-300">
                        {sessionSpendLimitValidationError}
                      </div>
                    ) : null}
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs" style={{ color: 'var(--muted)' }}>
                      <span>Interval Hours</span>
                      <span className="font-mono text-emerald-400">{intervalHours || 'Not set'}</span>
                    </div>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={intervalHours}
                      onChange={(event) => {
                        setIntervalPreset('CUSTOM');
                        setIntervalHours(event.target.value);
                      }}
                      placeholder="Enter interval in hours"
                      className="surface-input w-full px-3 py-2 text-sm"
                    />
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {([
                        ['DAILY', 'Daily: 24 hours', '24'],
                        ['WEEKLY', 'Weekly: 168 hours', '168'],
                        ['MONTHLY', 'Monthly: 720 hours', '720'],
                        ['CUSTOM', 'Custom', intervalHours],
                      ] as const).map(([preset, label, value]) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => {
                            setIntervalPreset(preset);
                            if (preset !== 'CUSTOM') setIntervalHours(value);
                          }}
                          className="rounded-lg border px-2 py-1.5 text-xs transition-colors"
                          style={{
                            borderColor: intervalPreset === preset ? 'var(--accent)' : 'var(--border)',
                            background: intervalPreset === preset ? 'rgba(var(--accent-rgb),0.10)' : 'transparent',
                            color: intervalPreset === preset ? 'var(--ink)' : 'var(--muted)',
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="mt-1 text-[11px]" style={{ color: 'var(--subtle)' }}>Use a whole number from 1 to 720 hours.</div>
                    {intervalValidationError ? <div className="mt-2 rounded-lg border border-rose-800/70 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-300">{intervalValidationError}</div> : null}
                  </div>
                  {isDcaRecipe ? (
                    <div>
                      <div className="mb-1 flex items-center justify-between text-xs" style={{ color: 'var(--muted)' }}>
                        <span>{t('totalDcaBudget')}</span>
                        <span className="font-mono text-emerald-400">{t('totalAllocation')}</span>
                      </div>
                      <input
                        type="text"
                        value={totalDcaBudgetUsdc}
                        onChange={(event) => setTotalDcaBudgetUsdc(event.target.value)}
                        placeholder={t('totalPlaceholder')}
                        className="surface-input w-full px-3 py-2 text-sm"
                      />
                      <div className="mt-3 mb-1 flex items-center justify-between text-xs" style={{ color: 'var(--muted)' }}>
                        <span>{t('perExecution')}</span>
                        <span className="font-mono text-emerald-400">{t('eachScheduledRun')}</span>
                      </div>
                      <input
                        type="text"
                        value={perExecutionUsdc}
                        onChange={(event) => setPerExecutionUsdc(event.target.value)}
                        placeholder={t('perExecutionPlaceholder')}
                        className="surface-input w-full px-3 py-2 text-sm"
                      />
                      <div className="mt-2 text-[11px]" style={{ color: 'var(--subtle)' }}>
                        {t('dcaValidationHint')}
                      </div>
                      <div className="mt-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--border)', background: 'var(--surface-inner)', color: 'var(--ink-2)' }}>
                        {t('estimatedRuns')}: <span className="font-mono text-emerald-400">{estimatedRuns.toString()}</span>
                        <div>Estimated total duration: <span className="font-mono text-emerald-400">{estimatedRuns > 0n ? (Number(estimatedRuns) - 1) * Number(intervalHours || 0) : 0} hours</span></div>
                      </div>
                      {sessionQuotaError ? <div className="mt-2 rounded-lg border px-3 py-2 text-[11px]" style={{ borderColor: 'rgba(235,87,87,0.30)', background: 'var(--danger-bg)', color: 'var(--danger)' }}>{sessionQuotaError}</div> : null}
                      {estimatedRuns > 0n && (Number(estimatedRuns) - 1) * Number(intervalHours || 0) > 30 * 24 * 0.9 ? <div className="mt-2 rounded-lg border px-3 py-2 text-[11px]" style={{ borderColor: 'rgba(242,153,74,0.30)', background: 'var(--warning-bg)', color: 'var(--warning)' }}>The session key may expire before the DCA completes. The session key will not be renewed automatically.</div> : null}
                      {dcaValidationError ? (
                        <div className="mt-2 rounded-lg border px-3 py-2 text-[11px]" style={{ borderColor: 'rgba(235,87,87,0.30)', background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                          {dcaValidationError}
                        </div>
                      ) : null}
                      <div className="mt-2 rounded-lg border px-3 py-2 text-[11px]" style={{ borderColor: 'rgba(var(--accent-rgb),0.20)', background: 'rgba(var(--accent-rgb),0.06)', color: 'var(--ink-2)' }}>
                        {t('allowancePolicy')} SharedExecutorProxy {SHARED_EXECUTOR_PROXY_SPENDER}.
                      </div>
                      {/* Allowance precheck panel */}
                      <div className="rounded-xl border p-3 space-y-2.5" style={{ borderColor: 'rgba(172,198,233,0.20)', background: 'rgba(172,198,233,0.04)' }}>
                        <div className="flex items-center justify-between">
                          <span className="mono text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>{t('runtimeAllowancePrecheck')}</span>
                          <button type="button"
                            onClick={async () => { await runAllowanceCheck(); }}
                            disabled={isCheckingAllowance || !connectedAddress || Boolean(dcaValidationError)}
                            className="rounded-lg border px-2.5 py-1 text-[10px] font-semibold transition-colors disabled:opacity-50"
                            style={{ borderColor: 'var(--border-strong)', background: 'var(--surface-inner)', color: 'var(--muted)' }}>
                            {isCheckingAllowance ? t('checking') : t('refresh')}
                          </button>
                        </div>
                        {!connectedAddress && <div className="text-[11px]" style={{ color: 'var(--warning)' }}>{t('connectForAllowance')}</div>}
                        {allowanceCheckError && <div className="text-[11px]" style={{ color: 'var(--danger)' }}>{allowanceCheckError}</div>}
                        {allowanceCheck && (
                          <div className="space-y-2">
                            {allowanceCheck.requiredSpenders && allowanceCheck.requiredSpenders.length > 0 ? (
                              <div className="space-y-1.5">
                                <div className="mono text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>{t('requiredApprovals')}</div>
                                {allowanceCheck.requiredSpenders.map((spender) => {
                                  const current = BigInt(allowanceCheck.allowanceBySpender?.[spender.toLowerCase()] || '0');
                                  const required = BigInt(allowanceCheck.requiredForSchedulerBaseUnits || '0');
                                  const isUnlimited = current >= maxUint256 / 2n;
                                  const isEnough = isUnlimited || current >= required;
                                  const isThisApproving = approvingSpender === spender.toLowerCase();
                                  const wasApproved = approvedSpenders.has(spender.toLowerCase());
                                  const displayCurrent = isUnlimited ? 'Unlimited' : `${formatUsdcBaseUnits(current.toString())} USDC`;
                                  return (
                                    <div key={spender} className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2"
                                      style={{ borderColor: isEnough || wasApproved ? 'rgba(111,207,151,0.20)' : 'rgba(242,153,74,0.20)', background: 'var(--surface-inner)' }}>
                                      <div className="min-w-0 flex-1">
                                        <div className="mono truncate text-[10px]" style={{ color: 'var(--subtle)' }}>{spender.slice(0, 16)}…{spender.slice(-4)}</div>
                                        <div className="mono text-[11px] font-semibold mt-0.5"
                                          style={{ color: isEnough || wasApproved ? 'var(--success)' : 'var(--warning)' }}>
                                          {displayCurrent} / {formatUsdcBaseUnits(required.toString())} USDC
                                          {(isEnough || wasApproved) ? ' ✓' : ''}
                                        </div>
                                      </div>
                                      {!isEnough && !wasApproved ? (
                                        <button type="button"
                                          disabled={isThisApproving || isApproveConfirming}
                                          onClick={() => handleApprove(spender, required.toString())}
                                          className="flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-60"
                                          style={{ color: 'var(--ink)', background: 'rgba(var(--accent-rgb),0.15)', border: '1px solid rgba(var(--accent-rgb),0.25)' }}>
                                          {isThisApproving || (isApproveConfirming && approvingSpender === spender.toLowerCase())
                                            ? <><Loader2 className="h-3 w-3 animate-spin" /> Approving…</>
                                            : 'Approve USDC'}
                                        </button>
                                      ) : (
                                        <span className="flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold"
                                          style={{ borderColor: 'rgba(111,207,151,0.25)', background: 'rgba(111,207,151,0.08)', color: 'var(--success)' }}>
                                          <CheckCheck className="h-3 w-3" /> Approved
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="mono text-[11px]" style={{ color: 'var(--muted)' }}>{t('allowanceNow')}: <span style={{ color: 'var(--ink)' }}>{formatUsdcBaseUnits(allowanceCheck.currentAllowanceBaseUnits)} USDC</span></div>
                            )}
                            <div className="grid grid-cols-2 gap-2 pt-1">
                              {[
                                { label: t('schedulerReadiness'), ok: allowanceCheck.isEnoughForScheduler, okText: t('ready'), failText: t('notReady') },
                                { label: t('activationReadiness'), ok: allowanceCheck.isEnoughForActivation, okText: t('ready'), failText: t('willRequireApprove') },
                              ].map(({ label, ok, okText, failText }) => (
                                <div key={label} className="rounded-lg border p-2" style={{ borderColor: ok ? 'rgba(111,207,151,0.20)' : 'rgba(242,153,74,0.20)', background: ok ? 'rgba(111,207,151,0.06)' : 'rgba(242,153,74,0.06)' }}>
                                  <div className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--subtle)' }}>{label}</div>
                                  <div className="mono text-[11px] font-semibold" style={{ color: ok ? 'var(--success)' : 'var(--warning)' }}>
                                    {ok ? `✓ ${okText}` : `⚠ ${failText}`}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="space-y-3">
                {/* Session Key status */}
                {isDcaRecipe && connectedAddress && isSessionKeyValid === false ? (
                  <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'rgba(167,139,250,0.30)', background: 'rgba(109,40,217,0.10)' }}>
                    <div className="flex items-center gap-2">
                      <Key className="h-4 w-4 shrink-0" style={{ color: '#a78bfa' }} />
                      <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#c4b5fd' }}>Keeper Authorization Required</span>
                    </div>
                    <p className="text-xs leading-relaxed" style={{ color: '#ddd6fe' }}>
                      Register a <span className="mono" style={{ color: 'var(--ink)' }}>Session Key</span> once to authorize the keeper to execute DCA on your behalf.
                    </p>
                    <div className="rounded-lg border px-3 py-2 mono text-[10px] space-y-1" style={{ borderColor: 'rgba(167,139,250,0.20)', background: 'rgba(109,40,217,0.15)', color: '#c4b5fd' }}>
                      <div>Keeper: <span style={{ color: 'var(--ink)' }}>{KEEPER_EOA.slice(0, 14)}…{KEEPER_EOA.slice(-6)}</span></div>
                      <div>Valid: <span style={{ color: 'var(--ink)' }}>{SESSION_KEY_DEFAULT_DAYS} days</span></div>
                      <div>Max spend: <span style={{ color: 'var(--ink)' }}>{sessionSpendLimitUsdc || DEFAULT_SESSION_SPEND_LIMIT_USDC} USDC</span></div>
                    </div>
                    <button type="button" disabled={isRegisteringSessionKey || isSessionKeyConfirming}
                      onClick={handleRegisterSessionKey}
                      className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all disabled:cursor-not-allowed disabled:opacity-60"
                      style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)' }}>
                      {isRegisteringSessionKey || isSessionKeyConfirming
                        ? <><Loader2 className="h-4 w-4 animate-spin" /> Registering…</>
                        : <><Key className="h-4 w-4" /> Register Session Key</>}
                    </button>
                  </div>
                ) : isDcaRecipe && connectedAddress && isSessionKeyValid === true ? (
                  <div className="flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs" style={{ borderColor: 'rgba(111,207,151,0.25)', background: 'rgba(111,207,151,0.08)', color: 'var(--success)' }}>
                    <CheckCheck className="h-4 w-4 shrink-0" />
                    <span>Session key active — execution authorized</span>
                  </div>
                ) : null}

                {/* Quick summary stats */}
                <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--surface-inner)' }}>
                  <div className="mono text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>{t('quickSummary')}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'rgba(172,198,233,0.05)' }}>
                      <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--subtle)' }}>{t('estimatedKeeperGas')}</div>
                      <div className="mono font-bold text-sm" style={{ color: 'var(--accent)' }}>~{recipe.estimatedGasUsdc}</div>
                      <div className="mono text-[10px]" style={{ color: 'var(--subtle)' }}>USDC / run</div>
                    </div>
                    <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'rgba(111,207,151,0.05)' }}>
                      <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--subtle)' }}>{t('expectedNetYield')}</div>
                      <div className="mono font-bold text-sm" style={{ color: 'var(--success)' }}>{recipe.expectedNetApy}</div>
                      <div className="mono text-[10px]" style={{ color: 'var(--subtle)' }}>estimated</div>
                    </div>
                  </div>
                  {isDcaRecipe && estimatedRuns > 0n && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--surface-inner)' }}>
                        <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--subtle)' }}>{t('estimatedRuns')}</div>
                        <div className="mono font-bold text-sm" style={{ color: 'var(--ink)' }}>{estimatedRuns.toString()}</div>
                        <div className="mono text-[10px]" style={{ color: 'var(--subtle)' }}>executions</div>
                      </div>
                      <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--surface-inner)' }}>
                        <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--subtle)' }}>Duration</div>
                        <div className="mono font-bold text-sm" style={{ color: 'var(--ink)' }}>
                          {Math.round((Number(estimatedRuns) - 1) * Number(intervalHours || 0) / 24)}d
                        </div>
                        <div className="mono text-[10px]" style={{ color: 'var(--subtle)' }}>
                          {(Number(estimatedRuns) - 1) * Number(intervalHours || 0)}h total
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Risk warning */}
                <div className="flex items-start gap-2.5 rounded-xl border p-3 text-xs" style={{ borderColor: 'rgba(242,153,74,0.25)', background: 'var(--warning-bg)', color: 'var(--warning)' }}>
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{recipe.recipeType === 'AUTO_COMPOUNDER' ? t('recipeAutoCompounderRisk') : t('recipeDcaRisk')}</span>
                </div>

                {/* DCA confirmation */}
                {isDcaRecipe && (
                  <div className="rounded-xl border p-3 text-xs space-y-1.5" style={{ borderColor: 'rgba(172,198,233,0.20)', background: 'rgba(172,198,233,0.05)', color: 'var(--ink-2)' }}>
                    <div className="mono text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>{t('dcaConfirmation')}</div>
                    <p className="leading-relaxed">
                      {t('dcaAuthorization')} <span className="mono" style={{ color: 'var(--ink)' }}>{totalDcaBudgetUsdc || '0'} USDC</span> total.
                      {' '}{t('eachExecutionUses')} <span className="mono" style={{ color: 'var(--ink)' }}>{perExecutionUsdc || '0'} USDC</span>.
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--muted)' }}>{t('dcaRisks')}</p>
                  </div>
                )}

                {/* Non-custodial guarantee */}
                <div className="flex items-start gap-2.5 rounded-xl border p-3 text-xs" style={{ borderColor: 'rgba(111,207,151,0.25)', background: 'rgba(111,207,151,0.05)', color: 'var(--success)' }}>
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{t('oneClickFlow')}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="sticky bottom-0 border-t px-6 py-4 backdrop-blur" style={{ borderColor: 'var(--border)', background: 'var(--modal-bg)' }}>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose();
                }}
                disabled={isConfirming}
                className="pointer-events-auto rounded-xl px-4 py-2 text-sm transition-colors"
                style={{ color: 'var(--ink-2)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = ''; }}
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                disabled={isConfirming || Boolean(sessionSpendLimitValidationError) || Boolean(intervalValidationError) || Boolean(isDcaRecipe && (dcaValidationError || sessionQuotaError))}
                onClick={async (event) => {
                  event.stopPropagation();
                  const clampedSlippage = Math.min(100, Math.max(10, maxSlippageBps));
                  const payload: {
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
                  } = {
                    maxSlippageBps: clampedSlippage,
                    sessionSpendLimitUsdc: sessionSpendLimitUsdc.trim(),
                    intervalHours: parseIntervalHours(intervalHours),
                    intervalPreset,
                    ...(isDcaRecipe ? { swapProvider: selectedSwapProvider } : {}),
                  };

                  // Ensure session spend limit parses correctly before submitting activation.
                  parseUsdcAmountToBaseUnits(sessionSpendLimitUsdc, 'Session spending limit');

                  if (isDcaRecipe) {
                    const parsed = parseDcaActivationConfig({
                      totalDcaBudgetUsdc,
                      perExecutionUsdc,
                      executionMode,
                    });

                    // Ensure 6-decimal parsing works before submitting activation.
                    parseUsdcAmountToBaseUnits(totalDcaBudgetUsdc, 'Total DCA Budget');
                    parseUsdcAmountToBaseUnits(perExecutionUsdc, 'Per Execution Amount');

                    if (estimateDcaRuns(parsed.totalDcaBudgetBaseUnits, parsed.perExecutionBaseUnits) <= 0n) {
                      throw new Error('Estimated runs must be at least 1.');
                    }

                    payload.dcaConfig = {
                      totalDcaBudgetUsdc: totalDcaBudgetUsdc.trim(),
                      perExecutionUsdc: perExecutionUsdc.trim(),
                      executionMode,
                      runtimeSpender: allowanceCheck?.runtimeSpender,
                      requiredSpenders: allowanceCheck?.requiredSpenders,
                    };
                  }

                  await onConfirm(payload);
                }}
                className="pointer-events-auto rounded-xl bg-gradient-to-r from-blue-600 to-emerald-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition-all hover:from-blue-500 hover:to-emerald-400 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isConfirming ? t('activating') : t('oneClickActivate')}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
