'use client';

import { SendPanel } from '@/components/SendPanel';
import { Navbar } from '@/components/Navbar';

export default function SendPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <p className="text-xs uppercase tracking-[0.28em]" style={{ color: 'var(--muted)' }}>Arc Testnet · USDC as gas</p>
          <h1 className="mt-2 text-3xl font-bold" style={{ color: 'var(--ink)' }}>Send USDC</h1>
        </div>
        <div className="max-w-lg">
          <SendPanel />
        </div>
      </main>
    </div>
  );
}
