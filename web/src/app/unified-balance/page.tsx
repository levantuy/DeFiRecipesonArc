'use client';

import { UnifiedBalancePanel } from '@/components/UnifiedBalancePanel';
import { Navbar } from '@/components/Navbar';

export default function UnifiedBalancePage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <p className="text-xs uppercase tracking-[0.28em]" style={{ color: 'var(--muted)' }}>Circle Gateway</p>
          <h1 className="mt-2 text-3xl font-bold" style={{ color: 'var(--ink)' }}>Unified Balance</h1>
        </div>
        <div className="max-w-lg">
          <UnifiedBalancePanel />
        </div>
      </main>
    </div>
  );
}
