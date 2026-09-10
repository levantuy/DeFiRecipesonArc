'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertTriangle, ArrowRight, ShieldAlert, X } from 'lucide-react';
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

export type RecipeType = 'AUTO_COMPOUNDER' | 'RECURRING_DCA';
export type SwapProvider = 'ARC_APP_KIT_SWAP';

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
const DCA_USDC_SPENDER = '0xf992efcb5fa2ed7cb48310d9dd8cb4ce5fb7ddc9';
const DCA_USDC_PROXY_SPENDER = '0xc06ebbefd94032b85424d51906e2a335efae264b';

interface SimulationModalProps {
  isOpen: boolean;
  recipe: RecipeConfig | null;
  onClose: () => void;
  onConfirm: (payload: {
    maxSlippageBps: number;
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
  const [totalDcaBudgetUsdc, setTotalDcaBudgetUsdc] = useState(recipe?.totalDcaBudgetUsdc ?? DCA_DEFAULT_TOTAL_BUDGET_USDC);
  const [perExecutionUsdc, setPerExecutionUsdc] = useState(recipe?.perExecutionUsdc ?? DCA_DEFAULT_PER_EXECUTION_USDC);
  const executionMode: DcaExecutionMode = 'PULL';
  const [allowanceCheck, setAllowanceCheck] = useState<DcaAllowancePrecheckResult | null>(null);
  const [allowanceCheckError, setAllowanceCheckError] = useState<string>('');
  const [isCheckingAllowance, setIsCheckingAllowance] = useState(false);

  useEffect(() => {
    if (recipe) {
      setMaxSlippageBps(recipe.maxSlippageBps);
      setTotalDcaBudgetUsdc(recipe.totalDcaBudgetUsdc ?? DCA_DEFAULT_TOTAL_BUDGET_USDC);
      setPerExecutionUsdc(recipe.perExecutionUsdc ?? DCA_DEFAULT_PER_EXECUTION_USDC);
      setAllowanceCheck(null);
      setAllowanceCheckError('');
      setIsCheckingAllowance(false);
    }
  }, [recipe]);

  const isDcaRecipe = recipe?.recipeType === 'RECURRING_DCA';
  let dcaValidationError: string | null = null;
  let estimatedRuns: bigint = 0n;

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
          <div className="flex items-center justify-between border-b border-slate-700/60 px-6 py-4">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              <h3 className="text-lg font-bold text-white">{t('modalTitle')}</h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isConfirming}
              className="text-slate-400 transition-colors hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-4">
            <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-sm">
                  <div className="text-xs uppercase tracking-wider font-mono text-slate-400">{t('recipeName')}</div>
                  <div className="mt-0.5 text-base font-semibold text-white">{recipe.recipeType === 'AUTO_COMPOUNDER' ? t('recipeAutoCompounderName') : t('recipeDcaName')}</div>
                </div>

                <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/80 p-4">
                  <div className="mb-2 text-xs uppercase tracking-wider font-mono text-slate-400">{t('routingAssetFlow')}</div>
                  <div className="space-y-2">
                    {(recipe.recipeType === 'AUTO_COMPOUNDER' ? dictionary.recipeAutoCompounderSteps : dictionary.recipeDcaSteps).map((step, index) => (
                      <div key={`${recipe.id}-${index}`} className="flex items-center gap-2 text-sm text-slate-200">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-blue-700 bg-blue-900/40 text-[10px] font-bold text-blue-300">
                          {index + 1}
                        </span>
                        <span>{step}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                    <span>{t('userWallet')}</span>
                    <ArrowRight className="h-4 w-4 text-emerald-400" />
                    <span>SharedExecutorProxy</span>
                    <ArrowRight className="h-4 w-4 text-emerald-400" />
                    <div className="max-w-[40%] truncate">{recipe.targetProtocol}</div>
                  </div>
                  <div className="mt-1 break-all text-[11px] font-mono text-slate-500">
                    {t('targetProtocol')}: {recipe.targetProtocolAddress || t('routeResolved')}
                  </div>
                  <div className="mt-1 break-all text-[11px] font-mono text-slate-500">
                    {t('swapProvider')}: {recipe.swapProvider || t('na')}
                  </div>
                </div>

                <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/80 p-4">
                  <div className="text-xs uppercase tracking-wider font-mono text-slate-400">{t('parametersProtection')}</div>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
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
                  {isDcaRecipe ? (
                    <div>
                      <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
                        <span>{t('totalDcaBudget')}</span>
                        <span className="font-mono text-emerald-400">{t('totalAllocation')}</span>
                      </div>
                      <input
                        type="text"
                        value={totalDcaBudgetUsdc}
                        onChange={(event) => setTotalDcaBudgetUsdc(event.target.value)}
                        placeholder={t('totalPlaceholder')}
                        className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                      />
                      <div className="mt-3 mb-1 flex items-center justify-between text-xs text-slate-400">
                        <span>{t('perExecution')}</span>
                        <span className="font-mono text-emerald-400">{t('eachScheduledRun')}</span>
                      </div>
                      <input
                        type="text"
                        value={perExecutionUsdc}
                        onChange={(event) => setPerExecutionUsdc(event.target.value)}
                        placeholder={t('perExecutionPlaceholder')}
                        className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                      />
                      <div className="mt-2 text-[11px] text-slate-500">
                        {t('dcaValidationHint')}
                      </div>
                      <div className="mt-2 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs text-slate-300">
                        {t('estimatedRuns')}: <span className="font-mono text-emerald-400">{estimatedRuns.toString()}</span>
                      </div>
                      {dcaValidationError ? (
                        <div className="mt-2 rounded-lg border border-rose-800/70 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-300">
                          {dcaValidationError}
                        </div>
                      ) : null}
                      <div className="mt-2 rounded-lg border border-blue-800/60 bg-blue-950/30 px-3 py-2 text-[11px] text-blue-200">
                        {t('allowancePolicy')} {DCA_USDC_SPENDER} and transfer proxy {DCA_USDC_PROXY_SPENDER}.
                      </div>
                      <div className="mt-2 rounded-lg border border-cyan-800/60 bg-cyan-950/30 px-3 py-2 text-[11px] text-cyan-200 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="uppercase tracking-wider">{t('runtimeAllowancePrecheck')}</span>
                          <button
                            type="button"
                            onClick={async () => {
                              await runAllowanceCheck();
                            }}
                            disabled={isCheckingAllowance || !connectedAddress || Boolean(dcaValidationError)}
                            className="rounded border border-cyan-700/70 px-2 py-0.5 text-[10px] text-cyan-200 disabled:opacity-50"
                          >
                            {isCheckingAllowance ? t('checking') : t('refresh')}
                          </button>
                        </div>
                        {!connectedAddress ? (
                          <div className="text-amber-200">{t('connectForAllowance')}</div>
                        ) : null}
                        {allowanceCheckError ? (
                          <div className="text-rose-300">{allowanceCheckError}</div>
                        ) : null}
                        {allowanceCheck ? (
                          <div className="space-y-1">
                            <div>{t('runtimeSpender')}: <span className="font-mono text-white break-all">{allowanceCheck.runtimeSpender}</span></div>
                            <div>{t('targetProtocol')}: <span className="font-mono text-white break-all">{allowanceCheck.targetProtocolAddress}</span></div>
                            <div>{t('allowanceNow')}: <span className="font-mono text-white">{formatUsdcBaseUnits(allowanceCheck.currentAllowanceBaseUnits)} USDC</span></div>
                            {allowanceCheck.requiredSpenders && allowanceCheck.requiredSpenders.length > 0 ? (
                              <div>
                                {t('requiredApprovals')}:
                                {allowanceCheck.requiredSpenders.map((spender) => (
                                  <div key={spender} className="font-mono text-white break-all">
                                    {spender} : {formatUsdcBaseUnits(allowanceCheck.allowanceBySpender?.[spender.toLowerCase()] || '0')} USDC
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            <div>{t('requiredScheduler')}: <span className="font-mono text-white">{formatUsdcBaseUnits(allowanceCheck.requiredForSchedulerBaseUnits)} USDC</span></div>
                            <div>{t('requiredActivation')}: <span className="font-mono text-white">{formatUsdcBaseUnits(allowanceCheck.requiredForActivationBaseUnits)} USDC</span></div>
                            <div className={allowanceCheck.isEnoughForScheduler ? 'text-emerald-300' : 'text-amber-200'}>
                              {t('schedulerReadiness')}: {allowanceCheck.isEnoughForScheduler ? t('ready') : t('notReady')}
                            </div>
                            <div className={allowanceCheck.isEnoughForActivation ? 'text-emerald-300' : 'text-amber-200'}>
                              {t('activationReadiness')}: {allowanceCheck.isEnoughForActivation ? t('ready') : t('willRequireApprove')}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                  <div className="text-xs uppercase tracking-wider font-mono text-slate-400">{t('quickSummary')}</div>
                  <div className="mt-3 space-y-3">
                    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                      <div className="text-xs text-slate-400">{t('estimatedKeeperGas')}</div>
                      <div className="mt-1 font-mono font-bold text-blue-400">~{recipe.estimatedGasUsdc} USDC</div>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                      <div className="text-xs text-slate-400">{t('expectedNetYield')}</div>
                      <div className="mt-1 font-mono font-bold text-emerald-400">{recipe.expectedNetApy}</div>
                    </div>
                  </div>
                </div>

                <div className="flex items-start space-x-2.5 rounded-xl border border-amber-800/60 bg-amber-950/40 p-3 text-xs text-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                  <span>{recipe.recipeType === 'AUTO_COMPOUNDER' ? t('recipeAutoCompounderRisk') : t('recipeDcaRisk')}</span>
                </div>

                {isDcaRecipe ? (
                  <div className="rounded-xl border border-blue-800/60 bg-blue-950/30 p-3 text-xs text-blue-200">
                    <div className="text-[11px] uppercase tracking-wider text-blue-300">{t('dcaConfirmation')}</div>
                    <div className="mt-2 leading-relaxed">
                      {t('dcaAuthorization')} <span className="font-mono text-white">{totalDcaBudgetUsdc || '0'} USDC</span> for this recurring DCA strategy.
                      {t('eachExecutionUses')} <span className="font-mono text-white">{perExecutionUsdc || '0'} USDC</span> {t('inMode')} <span className="font-mono text-white">PULL_PER_RUN</span>.
                    </div>
                    <div className="mt-2 text-[11px] text-blue-300">
                      {t('dcaRisks')}
                    </div>
                  </div>
                ) : null}

                <div className="flex items-start space-x-2.5 rounded-xl border border-emerald-800/60 bg-emerald-950/40 p-3 text-xs text-emerald-300">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  <span>
                    {t('oneClickFlow')}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="sticky bottom-0 border-t border-slate-700/60 bg-slate-950/80 px-6 py-4 backdrop-blur">
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose();
                }}
                disabled={isConfirming}
                className="pointer-events-auto rounded-xl px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                disabled={isConfirming || Boolean(isDcaRecipe && dcaValidationError)}
                onClick={async (event) => {
                  event.stopPropagation();
                  const clampedSlippage = Math.min(100, Math.max(10, maxSlippageBps));
                  const payload: {
                    maxSlippageBps: number;
                    dcaConfig?: {
                      totalDcaBudgetUsdc: string;
                      perExecutionUsdc: string;
                      executionMode: DcaExecutionMode;
                      runtimeSpender?: `0x${string}`;
                      requiredSpenders?: `0x${string}`[];
                    };
                  } = {
                    maxSlippageBps: clampedSlippage,
                  };

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
