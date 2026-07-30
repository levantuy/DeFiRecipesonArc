'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Layers, Play } from 'lucide-react';
import { RecipeConfig } from './SimulationModal';

export const RECIPES: (RecipeConfig & { description: string; risk: string; apy: string; defaultIntervalHours: number })[] = [
  {
    id: 'recipe-auto-compounder',
    recipeType: 'AUTO_COMPOUNDER',
    name: 'USDC Yield Auto-Compounder',
    description: 'Deposits USDC into Arc Lending, claims accrued rewards weekly, swaps to USDC via Arc DEX, and re-deposits for maximum yield.',
    targetProtocol: 'Arc Lending Protocol',
    targetProtocolAddress: '0xc97F7631461B2aF7e62C8d49116e58D01DEf7B16',
    maxSlippageBps: 50, // 0.5%
    estimatedGasUsdc: '0.0025',
    expectedNetApy: '8.4%',
    riskWarning: 'Rewards may vary with protocol emission changes and market liquidity.',
    routeSteps: ['Claim ARC rewards on Arc Lending', 'Swap ARC to USDC on Arc DEX', 'Deposit USDC back to Arc Lending'],
    risk: 'Low Risk',
    apy: '8.4% APY',
    defaultIntervalHours: 24 * 7,
  },
  {
    id: 'recipe-recurring-dca',
    recipeType: 'RECURRING_DCA',
    name: 'USDC Recurring DCA',
    description: 'Automated periodic DCA asset accumulation. Periodically swaps fixed USDC for target assets (ETH/BTC) on Arc DEX with strict slippage cap.',
    targetProtocol: 'Arc Official DEX Router',
    targetProtocolAddress: '0x0000000000000000000000000000000000001002',
    maxSlippageBps: 100, // 1.0%
    estimatedGasUsdc: '0.0018',
    expectedNetApy: 'Market dependent',
    riskWarning: 'Execution price may change when market volatility increases.',
    routeSteps: ['Pull fixed USDC allocation', 'Swap USDC to target asset on Arc DEX', 'Transfer acquired asset to user vault'],
    risk: 'Low-Medium Risk',
    apy: 'DCA Strategy',
    defaultIntervalHours: 24,
  },
  {
    id: 'recipe-smart-rebalancer',
    recipeType: 'SMART_YIELD_REBALANCER',
    name: 'USDC Smart Yield Rebalancer',
    description: 'Dynamic yield optimization. Automatically rebalances capital between Arc Lending and Treasury Vaults when APY delta exceeds 1.5%.',
    targetProtocol: 'Arc Lending & Treasury Vaults',
    targetProtocolAddress: '0x0000000000000000000000000000000000001003',
    maxSlippageBps: 50,
    estimatedGasUsdc: '0.0032',
    expectedNetApy: 'Dynamic',
    riskWarning: 'Frequent APY swings can increase execution frequency and gas usage.',
    routeSteps: ['Compare Arc Lending APY vs Treasury APY', 'Withdraw from lower-yield venue', 'Deposit into higher-yield venue'],
    risk: 'Medium Risk',
    apy: 'Dynamic APY',
    defaultIntervalHours: 6,
  },
];

interface RecipeCatalogProps {
  onSelectRecipe: (recipe: RecipeConfig) => void;
}

export const RecipeCatalog: React.FC<RecipeCatalogProps> = ({ onSelectRecipe }) => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center space-x-2">
          <Layers className="h-6 w-6 text-blue-400" />
          <span>Official USDC Recipes (MVP Scope)</span>
        </h2>
        <p className="text-slate-400 text-sm mt-1">
          Select an audited, non-custodial automated workflow to simulate and activate on Arc Testnet.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {RECIPES.map((recipe, index) => (
          <motion.div
            key={recipe.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="glass-card p-6 flex flex-col justify-between hover:border-blue-500/50 transition-all duration-300 group"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="px-2.5 py-1 rounded-full bg-emerald-950/80 border border-emerald-800 text-emerald-400 text-xs font-semibold">
                  {recipe.risk}
                </span>
                <span className="text-xs font-mono font-bold text-blue-400 bg-blue-950/60 px-2 py-0.5 rounded border border-blue-800">
                  {recipe.apy}
                </span>
              </div>

              <h3 className="text-lg font-bold text-white group-hover:text-blue-400 transition-colors">
                {recipe.name}
              </h3>
              <p className="text-slate-400 text-xs mt-2 leading-relaxed">
                {recipe.description}
              </p>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-between">
              <div className="text-xs text-slate-500 font-mono">
                Protocol: <span className="text-slate-300 font-sans">{recipe.targetProtocol}</span>
              </div>

              <button
                onClick={() => onSelectRecipe(recipe)}
                className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs shadow-md shadow-blue-500/20 transition-all"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Simulate & Activate</span>
              </button>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};
