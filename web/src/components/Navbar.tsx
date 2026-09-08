'use client';

import React from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { ShieldCheck, Zap } from 'lucide-react';
import { useChainId } from 'wagmi';
import { useLanguage } from '@/lib/i18n/LanguageProvider';

const ARC_CHAIN_ID = 5042002;

export const Navbar: React.FC = () => {
  const chainId = useChainId();
  const isArcChain = chainId === ARC_CHAIN_ID;
  const { lang, setLang, t } = useLanguage();

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
            <span>{t('navAudited')}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center space-x-4">
        <div className="hidden md:flex items-center space-x-2 px-3 py-1.5 rounded-full bg-slate-800/80 border border-slate-700 text-xs font-mono text-emerald-400">
          <span className={`h-2 w-2 rounded-full ${isArcChain ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
          <span>{isArcChain ? t('navArcTestnet') : t('navWrongNetwork')}</span>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-400" title={t('navLanguage')}>
          <span className="sr-only">{t('navLanguage')}</span>
          <select
            value={lang}
            onChange={(event) => setLang(event.target.value as 'en' | 'vi')}
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-semibold text-slate-200"
          >
            <option value="en">EN</option>
            <option value="vi">VI</option>
          </select>
        </label>
        <ConnectButton showBalance={false} />
      </div>
    </header>
  );
};
