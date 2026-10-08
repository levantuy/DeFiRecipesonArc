'use client';

import { useState } from 'react';
import { ArrowRight, CheckCircle2, ExternalLink, Loader2, TriangleAlert } from 'lucide-react';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2';
import type { EIP1193Provider } from 'viem';
import { getAppKit } from '@/lib/appkit/client';

const BRIDGE_CHAINS = [
  { id: 5042002,  kit: 'Arc_Testnet',      label: 'Arc Testnet' },
  { id: 84532,    kit: 'Base_Sepolia',     label: 'Base Sepolia' },
  { id: 11155111, kit: 'Ethereum_Sepolia', label: 'Ethereum Sepolia' },
  { id: 421614,   kit: 'Arbitrum_Sepolia', label: 'Arbitrum Sepolia' },
] as const;

type ChainEntry = typeof BRIDGE_CHAINS[number];
type StepState  = 'idle' | 'pending' | 'success' | 'error';

type BridgeStep = {
  name: string;
  label: string;
  state: StepState;
  txHash?: string;
};

const INITIAL_STEPS: BridgeStep[] = [
  { name: 'approve',          label: 'Approve USDC',        state: 'idle' },
  { name: 'burn',             label: 'Burn on source',      state: 'idle' },
  { name: 'fetchAttestation', label: 'Fetch attestation',   state: 'idle' },
  { name: 'mint',             label: 'Mint on destination', state: 'idle' },
];

function isPositiveDecimal(v: string) {
  return /^\d*\.?\d+$/.test(v.trim()) && Number(v) > 0;
}

export function BridgePanel() {
  const { connector, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();

  const [fromChain, setFromChain] = useState<ChainEntry>(BRIDGE_CHAINS[0]);
  const [toChain,   setToChain]   = useState<ChainEntry>(BRIDGE_CHAINS[1]);
  const [amount,    setAmount]    = useState('');
  const [recipient, setRecipient] = useState('');
  const [steps,     setSteps]     = useState<BridgeStep[]>(INITIAL_STEPS);
  const [bridging,  setBridging]  = useState(false);
  const [notice,    setNotice]    = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const fromChains = BRIDGE_CHAINS.filter(c => c.id !== toChain.id);
  const toChains   = BRIDGE_CHAINS.filter(c => c.id !== fromChain.id);

  function resetSteps() { setSteps(INITIAL_STEPS.map(s => ({ ...s, state: 'idle' as StepState }))); }

  function updateStep(name: string, state: StepState, txHash?: string) {
    setSteps(prev => prev.map(s => s.name === name ? { ...s, state, txHash } : s));
  }

  async function handleBridge() {
    if (!connector || !isConnected) return;
    if (!isPositiveDecimal(amount)) return;
    if (!/^0x[a-fA-F0-9]{40}$/.test(recipient)) return;

    setBridging(true);
    setNotice(null);
    resetSteps();

    try {
      if (chainId !== fromChain.id) await switchChainAsync({ chainId: fromChain.id });

      const provider = (await connector.getProvider()) as EIP1193Provider;
      const adapter  = await createViemAdapterFromProvider({ provider });
      const kit      = getAppKit();

      function onBridgeEvent(event: unknown) {
        if (!event || typeof event !== 'object') return;
        const e = event as Record<string, unknown>;
        if (typeof e.name !== 'string' || typeof e.state !== 'string') return;
        const st: StepState = e.state === 'success' ? 'success' : e.state === 'error' ? 'error' : 'pending';
        updateStep(e.name, st, typeof e.txHash === 'string' ? e.txHash : undefined);
      }

      type KitEmitter = { on: (e: string, cb: (v: unknown) => void) => void; off: (e: string, cb: (v: unknown) => void) => void };
      const emitter = kit as unknown as KitEmitter;
      emitter.on('bridge:stepUpdated', onBridgeEvent);

      let result: Awaited<ReturnType<typeof kit.bridge>>;
      try {
        result = await kit.bridge({
          from: { adapter, chain: fromChain.kit },
          to:   { adapter, chain: toChain.kit, recipientAddress: recipient },
          amount,
        });
      } finally {
        emitter.off('bridge:stepUpdated', onBridgeEvent);
      }

      if (result.steps) {
        for (const step of result.steps) {
          const st: StepState = step.state === 'success' ? 'success' : step.state === 'error' ? 'error' : 'idle';
          updateStep(step.name, st, (step as { txHash?: string }).txHash);
        }
      }

      setNotice({ type: 'success', text: `${amount} USDC bridged to ${toChain.label}.` });
      setAmount('');
      setRecipient('');
      setConfirmed(false);
    } catch (err) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Bridge failed.' });
      resetSteps();
    } finally {
      setBridging(false);
    }
  }

  const canConfirm = isConnected && isPositiveDecimal(amount) && /^0x[a-fA-F0-9]{40}$/.test(recipient) && fromChain.id !== toChain.id && !bridging;
  const anyStepActive = steps.some(s => s.state !== 'idle');

  return (
    <section className="glass-card overflow-hidden">
      {/* Header */}
      <div className="border-b px-5 py-4" style={{ borderColor: 'var(--border)' }}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Circle CCTP</p>
        <h3 className="display mt-1 text-xl font-semibold text-ink">Bridge USDC</h3>
        <p className="mt-1 text-sm text-muted">Move USDC across chains — approve, burn, attest, mint.</p>
      </div>

      <div className="p-5 space-y-4">
        {notice && (
          <div className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm ${
            notice.type === 'success'
              ? 'border-success/25 bg-success/8 text-success'
              : 'border-danger/25 bg-danger/8 text-danger'
          }`}>
            {notice.type === 'success'
              ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{notice.text}</span>
          </div>
        )}

        {/* Chain selectors */}
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block mb-1.5 text-[11px] font-semibold uppercase tracking-[0.10em] text-muted">From</label>
            <select
              value={fromChain.id}
              onChange={e => {
                const c = BRIDGE_CHAINS.find(x => x.id === Number(e.target.value))!;
                setFromChain(c);
                if (c.id === toChain.id) setToChain(BRIDGE_CHAINS.find(x => x.id !== c.id)!);
              }}
              className="w-full rounded-xl px-3 py-2.5 text-sm text-ink outline-none transition focus:ring-1"
              style={{ background: 'var(--surface-inner)', border: '1px solid var(--border)', fontFamily: 'inherit', colorScheme: 'inherit' }}
            >
              {fromChains.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl mb-0.5" style={{ background: 'var(--surface-strong)' }}>
            <ArrowRight className="h-4 w-4 text-muted" />
          </div>
          <div className="flex-1">
            <label className="block mb-1.5 text-[11px] font-semibold uppercase tracking-[0.10em] text-muted">To</label>
            <select
              value={toChain.id}
              onChange={e => {
                const c = BRIDGE_CHAINS.find(x => x.id === Number(e.target.value))!;
                setToChain(c);
                if (c.id === fromChain.id) setFromChain(BRIDGE_CHAINS.find(x => x.id !== c.id)!);
              }}
              className="w-full rounded-xl px-3 py-2.5 text-sm text-ink outline-none transition"
              style={{ background: 'var(--surface-inner)', border: '1px solid var(--border)', fontFamily: 'inherit', colorScheme: 'inherit' }}
            >
              {toChains.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
        </div>

        {/* Amount */}
        <div>
          <label className="block mb-1.5 text-[11px] font-semibold uppercase tracking-[0.10em] text-muted">Amount (USDC)</label>
          <div className="flex items-center gap-2 rounded-xl px-3.5 py-3" style={{ background: 'var(--surface-inner)', border: '1px solid var(--border)' }}>
            <input
              inputMode="decimal"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              className="display flex-1 bg-transparent text-2xl font-semibold tabular-nums text-ink placeholder:text-subtle outline-none"
            />
            <span className="mono text-sm font-medium text-muted shrink-0">USDC</span>
          </div>
        </div>

        {/* Recipient */}
        <div>
          <label className="block mb-1.5 text-[11px] font-semibold uppercase tracking-[0.10em] text-muted">Recipient on {toChain.label}</label>
          <input
            value={recipient}
            onChange={e => setRecipient(e.target.value)}
            placeholder="0x..."
            spellCheck={false}
            className="mono w-full rounded-xl px-3.5 py-2.5 text-sm text-ink placeholder:text-subtle outline-none"
            style={{ background: 'var(--surface-inner)', border: '1px solid var(--border)' }}
          />
          {recipient && !/^0x[a-fA-F0-9]{40}$/.test(recipient) && (
            <p className="mt-1.5 text-xs" style={{ color: 'var(--danger)' }}>Invalid address format</p>
          )}
        </div>

        {/* Preview summary */}
        {canConfirm && !confirmed && (
          <div className="rounded-xl p-3.5 space-y-2" style={{ background: 'var(--surface-inner)', border: '1px solid var(--border)' }}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.10em] text-muted mb-2.5">Review</p>
            {[
              ['Sending',   `${amount} USDC`],
              ['From',      fromChain.label],
              ['To',        toChain.label],
              ['Recipient', `${recipient.slice(0,6)}…${recipient.slice(-4)}`],
              ['Speed',     '~8–20 sec (CCTP v2)'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm">
                <span className="text-muted">{k}</span>
                <span className="mono text-ink font-medium">{v}</span>
              </div>
            ))}
          </div>
        )}

        {/* Step progress */}
        {anyStepActive && (
          <div className="rounded-xl p-3.5 space-y-2.5" style={{ background: 'var(--surface-inner)', border: '1px solid var(--border)' }}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.10em] text-muted mb-1">Progress</p>
            {steps.map(step => (
              <div key={step.name} className="flex items-center gap-3 text-sm">
                <span className="shrink-0">
                  {step.state === 'success' && <CheckCircle2 className="h-4 w-4" style={{ color: 'var(--success)' }} />}
                  {step.state === 'pending' && <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--accent)' }} />}
                  {step.state === 'error'   && <TriangleAlert className="h-4 w-4" style={{ color: 'var(--danger)' }} />}
                  {step.state === 'idle'    && <div className="h-4 w-4 rounded-full border-2" style={{ borderColor: 'var(--border-strong)' }} />}
                </span>
                <span className={
                  step.state === 'success' ? 'text-success' :
                  step.state === 'error'   ? 'text-danger'  :
                  step.state === 'pending' ? 'text-ink'     : 'text-muted'
                }>{step.label}</span>
                {step.txHash && (
                  <a
                    href={`https://testnet.arcscan.app/tx/${step.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto flex items-center gap-1 text-xs"
                    style={{ color: 'var(--accent)' }}
                  >
                    <ExternalLink className="h-3 w-3" />
                    Tx
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        {/* CTA */}
        {!isConnected ? (
          <ConnectButton showBalance={false} />
        ) : !confirmed ? (
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => setConfirmed(true)}
            className="w-full rounded-2xl py-3.5 text-sm font-semibold text-ink transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            Review Bridge
          </button>
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              disabled={bridging}
              onClick={handleBridge}
              className="w-full rounded-2xl py-3.5 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: bridging ? 'var(--surface-strong)' : 'var(--success)', color: 'var(--accent-fg)' }}
            >
              {bridging
                ? <span className="flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Bridging…</span>
                : `Confirm — Bridge ${amount} USDC`}
            </button>
            {!bridging && (
              <button type="button" onClick={() => setConfirmed(false)} className="w-full text-center text-xs text-muted hover:text-ink transition-colors py-1">
                Cancel
              </button>
            )}
          </div>
        )}
      </div>

      <div className="px-5 py-3 border-t text-center text-[11px] text-subtle" style={{ borderColor: 'var(--border)' }}>
        Powered by Circle CCTP · Keyless · No backend required
      </div>
    </section>
  );
}
