'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertTriangle, ArrowRight, ShieldAlert, X } from 'lucide-react';

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
  maxSlippageBps: number;
  estimatedGasUsdc: string;
  expectedNetApy: string;
  riskWarning: string;
  routeSteps: string[];
}

interface SimulationModalProps {
  isOpen: boolean;
  recipe: RecipeConfig | null;
  onClose: () => void;
  onConfirm: (payload: { maxSlippageBps: number }) => Promise<void> | void;
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

  useEffect(() => {
    if (recipe) {
      setMaxSlippageBps(recipe.maxSlippageBps);
    }
  }, [recipe]);

  if (!isOpen || !recipe) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="glass-modal w-full max-w-lg rounded-2xl p-6 shadow-2xl border border-blue-500/30"
        >
          <div className="flex items-center justify-between border-b border-slate-700/60 pb-4 mb-4">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              <h3 className="text-lg font-bold text-white">Pre-Flight Simulation (eth_call)</h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isConfirming}
              className="text-slate-400 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-sm">
              <div className="text-slate-400 text-xs uppercase tracking-wider font-mono">Recipe Name</div>
              <div className="text-white font-semibold text-base mt-0.5">{recipe.name}</div>
            </div>

            {/* Simulated Asset Flow Diagram */}
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
              <div className="text-xs text-slate-400 uppercase tracking-wider font-mono mb-2">Routing & Asset Flow</div>
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
              <div className="mt-3 flex items-center justify-between text-xs text-slate-300">
                <span>User Wallet (USDC 6d)</span>
                <ArrowRight className="h-4 w-4 text-emerald-400" />
                <span>SharedExecutorProxy</span>
                <ArrowRight className="h-4 w-4 text-emerald-400" />
                <div className="max-w-[40%] truncate">{recipe.targetProtocol}</div>
              </div>
              <div className="text-[11px] text-slate-500 font-mono mt-1 break-all">
                Target: {recipe.targetProtocolAddress || 'Route-resolved at runtime'}
              </div>
              <div className="text-[11px] text-slate-500 font-mono mt-1 break-all">
                Swap Provider: {recipe.swapProvider || 'N/A'}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
              <div className="text-xs text-slate-400 uppercase tracking-wider font-mono">Parameters & Protection</div>
              <div>
                <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
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
              <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                <div className="text-slate-400 text-xs">Estimated Keeper Gas Fee</div>
                <div className="text-blue-400 font-mono font-bold mt-1">
                  ~{recipe.estimatedGasUsdc} USDC
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                <div className="text-slate-400 text-xs">Expected Net Yield</div>
                <div className="text-emerald-400 font-mono font-bold mt-1">
                  {recipe.expectedNetApy}
                </div>
              </div>
            </div>

            <div className="flex items-start space-x-2.5 p-3 rounded-xl bg-amber-950/40 border border-amber-800/60 text-xs text-amber-200">
              <AlertTriangle className="h-4 w-4 text-amber-300 shrink-0 mt-0.5" />
              <span>{recipe.riskWarning}</span>
            </div>

            <div className="flex items-start space-x-2.5 p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-xs text-emerald-300">
              <ShieldAlert className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                One-click flow: sign in wallet once to register/refresh delegation when needed. If delegation is already valid, activation continues without a new on-chain registration tx.
              </span>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isConfirming}
              className="px-4 py-2 rounded-xl text-slate-300 hover:bg-slate-800 transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isConfirming}
              onClick={async () => {
                const clampedSlippage = Math.min(100, Math.max(10, maxSlippageBps));
                await onConfirm({ maxSlippageBps: clampedSlippage });
              }}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-emerald-500 hover:from-blue-500 hover:to-emerald-400 disabled:opacity-70 disabled:cursor-not-allowed text-white font-semibold text-sm shadow-lg shadow-blue-500/20 transition-all"
            >
              {isConfirming ? 'Activating...' : 'One-Click Activate'}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
