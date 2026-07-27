'use client';

import React from 'react';
import { Wallet, ArrowUpRight, History, CheckCircle, Clock } from 'lucide-react';

import { CONTRACT_ADDRESSES } from '../config/contracts';

interface AuditLog {
  id: string;
  recipeName: string;
  txHash: string;
  timestamp: string;
  status: 'CONFIRMED' | 'SIMULATED';
  gasUsedUsdc: string;
}

const MOCK_AUDIT_LOGS: AuditLog[] = [
  {
    id: 'log-1',
    recipeName: 'USDC Yield Auto-Compounder',
    txHash: '0x8f2a...39e1',
    timestamp: '10 mins ago',
    status: 'CONFIRMED',
    gasUsedUsdc: '0.0021 USDC',
  },
  {
    id: 'log-2',
    recipeName: 'USDC Recurring DCA',
    txHash: '0x4c1d...91b8',
    timestamp: '2 hours ago',
    status: 'CONFIRMED',
    gasUsedUsdc: '0.0017 USDC',
  },
];

export const PortfolioTracker: React.FC = () => {
  return (
    <div className="space-y-6">
      {/* Deployed Smart Contracts Card Banner */}
      <div className="glass-card p-5 border-l-4 border-l-blue-500 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-blue-400">
            Arc Testnet Deployed Contracts (Chain ID 5042002)
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-950 text-emerald-400 border border-emerald-800">
            Live on Arc
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
          <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
            <div className="text-slate-400 text-[10px]">SessionKeyRegistry</div>
            <a
              href={`https://testnet.arcscan.app/address/${CONTRACT_ADDRESSES.sessionKeyRegistry}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline truncate block mt-0.5"
            >
              {CONTRACT_ADDRESSES.sessionKeyRegistry}
            </a>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
            <div className="text-slate-400 text-[10px]">RecipeGuardrail</div>
            <a
              href={`https://testnet.arcscan.app/address/${CONTRACT_ADDRESSES.recipeGuardrail}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline truncate block mt-0.5"
            >
              {CONTRACT_ADDRESSES.recipeGuardrail}
            </a>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
            <div className="text-slate-400 text-[10px]">SharedExecutorProxy</div>
            <a
              href={`https://testnet.arcscan.app/address/${CONTRACT_ADDRESSES.sharedExecutorProxy}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline truncate block mt-0.5"
            >
              {CONTRACT_ADDRESSES.sharedExecutorProxy}
            </a>
          </div>
        </div>
      </div>

      {/* Portfolio Header Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-card p-5">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono uppercase">
            <span>Total USDC Balance (6 Decimals)</span>
            <Wallet className="h-4 w-4 text-blue-400" />
          </div>
          <div className="text-3xl font-extrabold text-white font-mono mt-2">
            $12,450.<span className="text-slate-400 text-xl">50</span>
          </div>
          <div className="text-xs text-emerald-400 mt-1 flex items-center space-x-1">
            <ArrowUpRight className="h-3.5 w-3.5" />
            <span>+8.4% APY Compounding Yield</span>
          </div>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono uppercase">
            <span>Active Automated Recipes</span>
            <Clock className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="text-3xl font-extrabold text-white font-mono mt-2">
            2 <span className="text-xs font-sans font-normal text-slate-400">Recipes Running</span>
          </div>
          <div className="text-xs text-slate-400 mt-1">
            Scoped Keeper Authorization Active
          </div>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono uppercase">
            <span>Cumulative Gas Saved</span>
            <CheckCircle className="h-4 w-4 text-purple-400" />
          </div>
          <div className="text-3xl font-extrabold text-white font-mono mt-2">
            $42.<span className="text-slate-400 text-xl">18</span>
          </div>
          <div className="text-xs text-purple-300 mt-1">
            Arc Native USDC Sub-Second Finality
          </div>
        </div>
      </div>

      {/* Execution Audit Log Table */}
      <div className="glass-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white flex items-center space-x-2">
            <History className="h-5 w-5 text-blue-400" />
            <span>Execution Audit Logs (Real-time Transparent History)</span>
          </h3>
          <span className="text-xs text-slate-400 font-mono">Audited SharedExecutorProxy</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-900/60 text-xs uppercase font-mono text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-4 py-3">Recipe</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Transaction Hash</th>
                <th className="px-4 py-3">Gas Fee (USDC)</th>
                <th className="px-4 py-3">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {MOCK_AUDIT_LOGS.map((log) => (
                <tr key={log.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-white">{log.recipeName}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-950 border border-emerald-800 text-emerald-400">
                      <CheckCircle className="h-3 w-3" />
                      <span>{log.status}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-blue-400 text-xs">{log.txHash}</td>
                  <td className="px-4 py-3 font-mono text-xs">{log.gasUsedUsdc}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{log.timestamp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
