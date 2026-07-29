'use client';

import React from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { ShieldCheck, Zap } from 'lucide-react';
import { useChainId } from 'wagmi';

const ARC_CHAIN_ID = 5042002;

export const Navbar: React.FC = () => {
  const chainId = useChainId();
  const isArcChain = chainId === ARC_CHAIN_ID;

  return (
    <header className="sticky top-0 z-50 glass-card rounded-none border-b border-cardBorder px-6 py-4 flex items-center justify-between">
      <div className="flex items-center space-x-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-blue-600 to-emerald-400 flex items-center justify-center shadow-lg shadow-blue-500/20">
          <Zap className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold gradient-text">DeFi Recipes on Arc</h1>
          <div className="flex items-center space-x-2 text-xs text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            <span>Audited Proxy &bull; USDC Native Gas</span>
          </div>
        </div>
      </div>

      <div className="flex items-center space-x-4">
        <div className="hidden md:flex items-center space-x-2 px-3 py-1.5 rounded-full bg-slate-800/80 border border-slate-700 text-xs font-mono text-emerald-400">
          <span className={`h-2 w-2 rounded-full ${isArcChain ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
          <span>{isArcChain ? 'Arc Testnet (5042002)' : 'Wrong Network - switch to Arc 5042002'}</span>
        </div>
        <ConnectButton showBalance={false} />
      </div>
    </header>
  );
};
