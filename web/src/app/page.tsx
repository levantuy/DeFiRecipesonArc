'use client';

import React, { useState } from 'react';
import { Navbar } from '@/components/Navbar';
import { RecipeCatalog } from '@/components/RecipeCatalog';
import { SimulationModal, RecipeConfig } from '@/components/SimulationModal';
import { PortfolioTracker } from '@/components/PortfolioTracker';
import { ShieldCheck, Sparkles, Cpu } from 'lucide-react';

export default function Home() {
  const [selectedRecipe, setSelectedRecipe] = useState<RecipeConfig | null>(null);

  const handleConfirmSimulation = () => {
    alert(`Successfully simulated & activated ${selectedRecipe?.name}! Keeper engine delegation updated.`);
    setSelectedRecipe(null);
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

        {/* Portfolio Tracker & Execution Audit Log */}
        <PortfolioTracker />
      </main>

      {/* Pre-flight Simulation Modal */}
      <SimulationModal
        isOpen={selectedRecipe !== null}
        recipe={selectedRecipe}
        onClose={() => setSelectedRecipe(null)}
        onConfirm={handleConfirmSimulation}
      />

      <footer className="border-t border-slate-800/80 py-6 text-center text-xs text-slate-500 font-mono">
        DeFi Recipes on Arc &bull; Community-built for Arc Network (Chain ID: 5042002)
      </footer>
    </div>
  );
}
