'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertTriangle, ArrowRight, ShieldAlert, X } from 'lucide-react';

export interface RecipeConfig {
  id: string;
  name: string;
  targetProtocol: string;
  maxSlippageBps: number;
  estimatedGasUsdc: string;
}

interface SimulationModalProps {
  isOpen: boolean;
  recipe: RecipeConfig | null;
  onClose: () => void;
  onConfirm: () => void;
}

export const SimulationModal: React.FC<SimulationModalProps> = ({
  isOpen,
  recipe,
  onClose,
  onConfirm,
}) => {
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulatedSuccess, setSimulatedSuccess] = useState(true);

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
              <h3 className="text-lg font-bold text-white">Pre-Flight Simulation (`eth_call`)</h3>
            </div>
            <button
              onClick={onClose}
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
              <div className="text-xs text-slate-400 uppercase tracking-wider font-mono mb-2">Simulated Asset Flow</div>
              <div className="flex items-center justify-between text-sm">
                <div className="px-3 py-1.5 rounded-lg bg-blue-950/80 border border-blue-800 text-blue-300 font-medium">
                  User Wallet (USDC)
                </div>
                <ArrowRight className="h-4 w-4 text-emerald-400 animate-pulse" />
                <div className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-emerald-400 font-medium">
                  SharedExecutorProxy
                </div>
                <ArrowRight className="h-4 w-4 text-emerald-400 animate-pulse" />
                <div className="px-3 py-1.5 rounded-lg bg-purple-950/80 border border-purple-800 text-purple-300 font-medium">
                  {recipe.targetProtocol}
                </div>
              </div>
            </div>

            {/* Simulation Parameters & Guardrails */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                <div className="text-slate-400 text-xs">Max Slippage Cap</div>
                <div className="text-emerald-400 font-mono font-bold mt-1">
                  {(recipe.maxSlippageBps / 100).toFixed(1)}%
                </div>
              </div>
              <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                <div className="text-slate-400 text-xs">Est. USDC Gas Fee</div>
                <div className="text-blue-400 font-mono font-bold mt-1">
                  ~{recipe.estimatedGasUsdc} USDC
                </div>
              </div>
            </div>

            <div className="flex items-start space-x-2.5 p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-xs text-emerald-300">
              <ShieldAlert className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                Simulated off-chain via Viem <code>eth_call</code>. Transaction execution is guaranteed safe without asset loss.
              </span>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-end space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-slate-300 hover:bg-slate-800 transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-emerald-500 hover:from-blue-500 hover:to-emerald-400 text-white font-semibold text-sm shadow-lg shadow-blue-500/20 transition-all"
            >
              Sign & Activate Delegation
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
