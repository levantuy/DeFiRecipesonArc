'use client';

import { BridgePanel } from '@/components/BridgePanel';
import { Navbar } from '@/components/Navbar';

export default function BridgePage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <p className="text-xs uppercase tracking-[0.28em]" style={{ color: 'var(--muted)' }}>Cross-Chain Transfer Protocol</p>
          <h1 className="mt-2 text-3xl font-bold" style={{ color: 'var(--ink)' }}>Bridge USDC</h1>
        </div>
        <div className="max-w-lg">
          <BridgePanel />
        </div>
      </main>
    </div>
  );
}
