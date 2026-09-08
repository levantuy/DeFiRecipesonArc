'use client';

import { SwapPanel } from '@/components/SwapPanel';
import { Navbar } from '@/components/Navbar';
import { useLanguage } from '@/lib/i18n/LanguageProvider';

export default function SwapPage() {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <p className="text-xs uppercase tracking-[0.28em] text-slate-400">{t('swapPageEyebrow')}</p>
          <h1 className="mt-2 text-3xl font-bold text-white">{t('swapPageTitle')}</h1>
        </div>
        <SwapPanel />
      </main>
    </div>
  );
}
