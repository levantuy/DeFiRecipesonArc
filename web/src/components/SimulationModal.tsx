'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertTriangle, ArrowRight, ShieldAlert, X } from 'lucide-react';
import {
  DcaExecutionMode,
  estimateDcaRuns,
  parseDcaActivationConfig,
  parseUsdcAmountToBaseUnits,
} from '@/lib/dcaConfig';

export type RecipeType = 'AUTO_COMPOUNDER' | 'RECURRING_DCA' | 'SMART_YIELD_REBALANCER';
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
    };
  }) => Promise<void> | void;
  isConfirming?: boolean;
}

export const SimulationModal: React.FC<SimulationModalProps> = ({
  isOpen,
  recipe,
  onClose,
  onConfirm,
  isConfirming = false,
}) => {
  const [maxSlippageBps, setMaxSlippageBps] = useState(recipe?.maxSlippageBps ?? 50);
  const [totalDcaBudgetUsdc, setTotalDcaBudgetUsdc] = useState(recipe?.totalDcaBudgetUsdc ?? DCA_DEFAULT_TOTAL_BUDGET_USDC);
  const [perExecutionUsdc, setPerExecutionUsdc] = useState(recipe?.perExecutionUsdc ?? DCA_DEFAULT_PER_EXECUTION_USDC);
  const [executionMode, setExecutionMode] = useState<DcaExecutionMode>(recipe?.executionMode ?? 'PULL');

  useEffect(() => {
    if (recipe) {
      setMaxSlippageBps(recipe.maxSlippageBps);
      setTotalDcaBudgetUsdc(recipe.totalDcaBudgetUsdc ?? DCA_DEFAULT_TOTAL_BUDGET_USDC);
      setPerExecutionUsdc(recipe.perExecutionUsdc ?? DCA_DEFAULT_PER_EXECUTION_USDC);
      setExecutionMode(recipe.executionMode ?? 'PULL');
    }
  }, [recipe]);

  if (!isOpen || !recipe) return null;

  const isDcaRecipe = recipe.recipeType === 'RECURRING_DCA';
  let dcaValidationError: string | null = null;
  let estimatedRuns: bigint = 0n;

  if (isDcaRecipe) {
    try {
      const parsed = parseDcaActivationConfig({
        totalDcaBudgetUsdc,
        perExecutionUsdc,
        executionMode,
      });
      estimatedRuns = estimateDcaRuns(parsed.totalDcaBudgetBaseUnits, parsed.perExecutionBaseUnits);
      if (estimatedRuns <= 0n) {
        dcaValidationError = 'Estimated runs is 0. Increase budget or reduce per execution amount.';
      }
    } catch (error: unknown) {
      dcaValidationError = error instanceof Error ? error.message : 'Invalid DCA configuration.';
    }
  }

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
              <h3 className="text-lg font-bold text-white">Pre-Flight Simulation (eth_call)</h3>
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
                  <div className="text-xs uppercase tracking-wider font-mono text-slate-400">Recipe Name</div>
                  <div className="mt-0.5 text-base font-semibold text-white">{recipe.name}</div>
                </div>

                <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/80 p-4">
                  <div className="mb-2 text-xs uppercase tracking-wider font-mono text-slate-400">Routing & Asset Flow</div>
                  <div className="space-y-2">
                    {recipe.routeSteps.map((step, index) => (
                      <div key={`${recipe.id}-${index}`} className="flex items-center gap-2 text-sm text-slate-200">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-blue-700 bg-blue-900/40 text-[10px] font-bold text-blue-300">
                          {index + 1}
                        </span>
                        <span>{step}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                    <span>User Wallet (USDC 6d)</span>
                    <ArrowRight className="h-4 w-4 text-emerald-400" />
                    <span>SharedExecutorProxy</span>
                    <ArrowRight className="h-4 w-4 text-emerald-400" />
                    <div className="max-w-[40%] truncate">{recipe.targetProtocol}</div>
                  </div>
                  <div className="mt-1 break-all text-[11px] font-mono text-slate-500">
                    Target: {recipe.targetProtocolAddress || 'Route-resolved at runtime'}
                  </div>
                  <div className="mt-1 break-all text-[11px] font-mono text-slate-500">
                    Swap Provider: {recipe.swapProvider || 'N/A'}
                  </div>
                </div>

                <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/80 p-4">
                  <div className="text-xs uppercase tracking-wider font-mono text-slate-400">Parameters & Protection</div>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
                      <span>Max Slippage Tolerance</span>
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
                        <span>Total DCA Budget (USDC)</span>
                        <span className="font-mono text-emerald-400">Total allocation</span>
                      </div>
                      <input
                        type="text"
                        value={totalDcaBudgetUsdc}
                        onChange={(event) => setTotalDcaBudgetUsdc(event.target.value)}
                        placeholder="e.g. 100"
                        className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                      />
                      <div className="mt-3 mb-1 flex items-center justify-between text-xs text-slate-400">
                        <span>Per Execution Amount (USDC)</span>
                        <span className="font-mono text-emerald-400">Each scheduled run</span>
                      </div>
                      <input
                        type="text"
                        value={perExecutionUsdc}
                        onChange={(event) => setPerExecutionUsdc(event.target.value)}
                        placeholder="e.g. 5"
                        className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                      />
                      <div className="mt-3 mb-1 flex items-center justify-between text-xs text-slate-400">
                        <span>Execution Mode</span>
                        <span className="font-mono text-emerald-400">Choose funding model</span>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs text-slate-200">
                          <input
                            type="radio"
                            name="dca-execution-mode"
                            value="PREFUND"
                            checked={executionMode === 'PREFUND'}
                            onChange={() => setExecutionMode('PREFUND')}
                            className="mt-0.5"
                          />
                          <span>
                            <span className="block font-semibold text-white">Prefund to Contract</span>
                            <span className="text-slate-400">Fund total budget at activation.</span>
                          </span>
                        </label>
                        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs text-slate-200">
                          <input
                            type="radio"
                            name="dca-execution-mode"
                            value="PULL"
                            checked={executionMode === 'PULL'}
                            onChange={() => setExecutionMode('PULL')}
                            className="mt-0.5"
                          />
                          <span>
                            <span className="block font-semibold text-white">Pull from Wallet each run</span>
                            <span className="text-slate-400">Pull per execution using allowance.</span>
                          </span>
                        </label>
                      </div>
                      <div className="mt-2 text-[11px] text-slate-500">
                        Supports up to 6 decimals. Validation: total &gt; 0, per execution &gt; 0, per execution ≤ total.
                      </div>
                      <div className="mt-2 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs text-slate-300">
                        Estimated Runs: <span className="font-mono text-emerald-400">{estimatedRuns.toString()}</span>
                      </div>
                      {dcaValidationError ? (
                        <div className="mt-2 rounded-lg border border-rose-800/70 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-300">
                          {dcaValidationError}
                        </div>
                      ) : null}
                      <div className="mt-2 rounded-lg border border-blue-800/60 bg-blue-950/30 px-3 py-2 text-[11px] text-blue-200">
                        Required before scheduler enqueue: approve USDC allowance for spender {DCA_USDC_SPENDER} and transfer proxy {DCA_USDC_PROXY_SPENDER}. 
                        Policy for this UI: approve once with the full Total DCA Budget.
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                  <div className="text-xs uppercase tracking-wider font-mono text-slate-400">Quick Summary</div>
                  <div className="mt-3 space-y-3">
                    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                      <div className="text-xs text-slate-400">Estimated Keeper Gas Fee</div>
                      <div className="mt-1 font-mono font-bold text-blue-400">~{recipe.estimatedGasUsdc} USDC</div>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                      <div className="text-xs text-slate-400">Expected Net Yield</div>
                      <div className="mt-1 font-mono font-bold text-emerald-400">{recipe.expectedNetApy}</div>
                    </div>
                  </div>
                </div>

                <div className="flex items-start space-x-2.5 rounded-xl border border-amber-800/60 bg-amber-950/40 p-3 text-xs text-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                  <span>{recipe.riskWarning}</span>
                </div>

                {isDcaRecipe ? (
                  <div className="rounded-xl border border-blue-800/60 bg-blue-950/30 p-3 text-xs text-blue-200">
                    <div className="text-[11px] uppercase tracking-wider text-blue-300">DCA Activation Confirmation</div>
                    <div className="mt-2 leading-relaxed">
                      You authorize the automation system to use up to <span className="font-mono text-white">{totalDcaBudgetUsdc || '0'} USDC</span> for this recurring DCA strategy.
                      Each execution uses <span className="font-mono text-white">{perExecutionUsdc || '0'} USDC</span> in <span className="font-mono text-white">{executionMode === 'PREFUND' ? 'PREFUND' : 'PULL_PER_RUN'}</span> mode.
                    </div>
                    <div className="mt-2 text-[11px] text-blue-300">
                      Risks: market slippage, route liquidity changes, and allowance availability for pull-based execution.
                    </div>
                  </div>
                ) : null}

                <div className="flex items-start space-x-2.5 rounded-xl border border-emerald-800/60 bg-emerald-950/40 p-3 text-xs text-emerald-300">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  <span>
                    One-click flow: sign in wallet once to register/refresh delegation when needed. If delegation is already valid, activation continues without a new on-chain registration tx.
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
                Cancel
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
                    };
                  }

                  await onConfirm(payload);
                }}
                className="pointer-events-auto rounded-xl bg-gradient-to-r from-blue-600 to-emerald-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition-all hover:from-blue-500 hover:to-emerald-400 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isConfirming ? 'Activating...' : 'One-Click Activate'}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
