'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, RefreshCcw, TrendingUp } from 'lucide-react';
import { RecipeConfig } from './SimulationModal';
import { useLanguage } from '@/lib/i18n/LanguageProvider';

export const RECIPES: (RecipeConfig & { description: string; risk: string; apy: string; defaultIntervalHours: number })[] = [
  {
    id: 'recipe-auto-compounder',
    recipeType: 'AUTO_COMPOUNDER',
    name: 'USDC Yield Auto-Compounder',
    description: 'Deposits USDC into Arc Lending, claims accrued rewards weekly, swaps to USDC via Arc App Kit Swap, and re-deposits for maximum yield.',
    targetProtocol: 'Arc Lending Protocol',
    targetProtocolAddress: '0x6cB6eE2a33F497C1a682657f15A874dc675Fa773',
    maxSlippageBps: 50,
    estimatedGasUsdc: '0.0025',
    expectedNetApy: '8.4%',
    riskWarning: 'Rewards may vary with protocol emission changes and market liquidity.',
    routeSteps: ['Claim ARC rewards on Arc Lending', 'Swap ARC to USDC via Arc App Kit Swap', 'Deposit USDC back to Arc Lending'],
    risk: 'Low Risk',
    apy: '8.4% APY',
    defaultIntervalHours: 168,
  },
  {
    id: 'recipe-recurring-dca',
    recipeType: 'RECURRING_DCA',
    name: 'USDC -> EURC Recurring DCA',
    description: 'Automated periodic DCA accumulation. Configure total budget and per-execution amount before activation.',
    targetProtocol: 'Arc App Kit Swap API',
    swapProvider: 'ARC_APP_KIT_SWAP',
    targetAssetSymbol: 'EURC',
    totalDcaBudgetUsdc: '50',
    perExecutionUsdc: '5',
    executionMode: 'PULL',
    maxSlippageBps: 100,
    estimatedGasUsdc: '0.0018',
    expectedNetApy: 'Market dependent',
    riskWarning: 'Execution price may change when market volatility increases. Keep slippage policy conservative and maintain sufficient allowance/balance for recurring runs.',
    routeSteps: ['Configure total DCA budget and per-execution amount', 'Swap USDC to EURC via Arc App Kit Swap', 'Transfer acquired EURC to user vault'],
    risk: 'Low-Medium Risk',
    apy: 'DCA Strategy',
    defaultIntervalHours: 24,
  },
];

interface RecipeCatalogProps {
  onSelectRecipe: (recipe: RecipeConfig) => void;
}

const CARD_META = {
  AUTO_COMPOUNDER: {
    icon: <TrendingUp className="h-5 w-5" />,
    iconBg: 'rgba(111,207,151,0.12)',
    iconColor: 'var(--success)',
    riskColor: 'text-success',
    riskBg: 'var(--success-bg)',
    riskBorder: 'rgba(111,207,151,0.25)',
    apyColor: 'var(--accent)',
    apyBorder: 'rgba(172,198,233,0.25)',
    apyBg: 'rgba(172,198,233,0.08)',
    accentBar: 'from-emerald-500/60 to-blue-500/60',
  },
  RECURRING_DCA: {
    icon: <RefreshCcw className="h-5 w-5" />,
    iconBg: 'rgba(172,198,233,0.12)',
    iconColor: 'var(--accent)',
    riskColor: 'text-warning',
    riskBg: 'var(--warning-bg)',
    riskBorder: 'rgba(242,153,74,0.25)',
    apyColor: 'var(--ink-2)',
    apyBorder: 'rgba(255,255,255,0.12)',
    apyBg: 'rgba(255,255,255,0.06)',
    accentBar: 'from-blue-500/60 to-violet-500/60',
  },
} as const;

export const RecipeCatalog: React.FC<RecipeCatalogProps> = ({ onSelectRecipe }) => {
  const { t } = useLanguage();

  return (
    <section className="space-y-5">
      <div>
        <h2 className="display text-xl font-semibold text-ink">{t('recipeCatalogTitle')}</h2>
        <p className="mt-1 text-sm text-muted text-pretty">{t('recipeCatalogDescription')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {RECIPES.map((recipe, index) => {
          const meta = CARD_META[recipe.recipeType as keyof typeof CARD_META] ?? CARD_META.AUTO_COMPOUNDER;

          return (
            <motion.article
              key={recipe.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.07, duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="glass-card group flex flex-col overflow-hidden"
            >
              {/* Accent bar */}
              <div className={`h-[3px] w-full bg-gradient-to-r ${meta.accentBar}`} />

              <div className="flex flex-col flex-1 p-5">
                {/* Header row */}
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                    style={{ background: meta.iconBg, color: meta.iconColor }}
                  >
                    {meta.icon}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span
                      className="rounded-full border px-2.5 py-0.5 text-[11px] font-semibold"
                      style={{ background: meta.riskBg, borderColor: meta.riskBorder }}
                    >
                      <span className={meta.riskColor}>
                        {recipe.recipeType === 'AUTO_COMPOUNDER' ? t('lowRisk') : t('lowMediumRisk')}
                      </span>
                    </span>
                    <span
                      className="mono rounded-full border px-2.5 py-0.5 text-[11px] font-semibold"
                      style={{ background: meta.apyBg, borderColor: meta.apyBorder, color: meta.apyColor }}
                    >
                      {recipe.recipeType === 'AUTO_COMPOUNDER' ? t('apy') : t('dcaStrategy')}
                    </span>
                  </div>
                </div>

                {/* Content */}
                <h3 className="display text-base font-semibold text-ink leading-snug group-hover:text-accent transition-colors">
                  {recipe.recipeType === 'AUTO_COMPOUNDER' ? t('recipeAutoCompounderName') : t('recipeDcaName')}
                </h3>
                <p className="mt-2 text-sm text-muted leading-relaxed text-pretty">
                  {recipe.recipeType === 'AUTO_COMPOUNDER' ? t('recipeAutoCompounderDescription') : t('recipeDcaDescription')}
                </p>

                {/* Route steps */}
                <ol className="mt-4 space-y-1.5">
                  {recipe.routeSteps.map((step, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-subtle">
                      <span
                        className="mono mt-0.5 shrink-0 h-4 w-4 flex items-center justify-center rounded text-[10px] font-bold"
                        style={{ background: 'var(--surface-strong)', color: 'var(--muted)' }}
                      >
                        {i + 1}
                      </span>
                      <span className="leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ol>

                {/* Footer */}
                <div className="mt-5 pt-4 flex items-center justify-between border-t" style={{ borderColor: 'var(--border)' }}>
                  <div className="text-[11px] text-subtle mono">
                    {t('protocol')}: <span className="text-muted font-sans">{recipe.targetProtocol}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelectRecipe(recipe)}
                    className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold text-ink transition-all hover:scale-[1.03] active:scale-[0.98]"
                    style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
                  >
                    {t('simulateActivate')}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </motion.article>
          );
        })}
      </div>
    </section>
  );
};
