'use client';

import { useCallback, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, TriangleAlert, Wallet } from 'lucide-react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2';
import { isAddress } from 'viem';
import type { EIP1193Provider } from 'viem';
import { UnifiedBalanceChain } from '@circle-fin/app-kit';
import { getAppKit } from '@/lib/appkit/client';

const SOURCE_CHAINS = [
  { id: 5042002,  kit: 'Arc_Testnet',      label: 'Arc Testnet' },
  { id: 84532,    kit: 'Base_Sepolia',     label: 'Base Sepolia' },
  { id: 11155111, kit: 'Ethereum_Sepolia', label: 'Ethereum Sepolia' },
] as const;

type SourceChain  = typeof SOURCE_CHAINS[number];
type BalanceEntry = { chain: string; amount: string; token: string };
type Tab          = 'balances' | 'deposit' | 'spend';

function isPositiveDecimal(v: string) {
  return /^\d*\.?\d+$/.test(v.trim()) && Number(v) > 0;
}

export function UnifiedBalancePanel() {
  const { connector, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();

  const [tab,        setTab]        = useState<Tab>('balances');
  const [balances,   setBalances]   = useState<BalanceEntry[]>([]);
  const [loadingBal, setLoadingBal] = useState(false);

  const [srcChain,   setSrcChain]   = useState<SourceChain>(SOURCE_CHAINS[0]);
  const [depositAmt, setDepositAmt] = useState('');
  const [depositing, setDepositing] = useState(false);

  const [spendSrc,   setSpendSrc]   = useState<SourceChain>(SOURCE_CHAINS[0]);
  const [spendDst,   setSpendDst]   = useState<string>('Arc_Testnet');
  const [spendAmt,   setSpendAmt]   = useState('');
  const [spendTo,    setSpendTo]    = useState('');
  const [spending,   setSpending]   = useState(false);

  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const getAdapter = useCallback(async (requiredChainId: number) => {
    if (!connector) throw new Error('Wallet not connected');
    if (chainId !== requiredChainId) await switchChainAsync({ chainId: requiredChainId });
    const provider = (await connector.getProvider()) as EIP1193Provider;
    return createViemAdapterFromProvider({ provider });
  }, [connector, chainId, switchChainAsync]);

  async function fetchBalances() {
    if (!connector) return;
    setLoadingBal(true);
    setNotice(null);
    try {
      const provider = (await connector.getProvider()) as EIP1193Provider;
      const adapter  = await createViemAdapterFromProvider({ provider });
      const result   = await getAppKit().unifiedBalance.getBalances({ sources: { adapter }, networkType: 'testnet' });
      const entries: BalanceEntry[] = [];
      const raw = result as unknown as Record<string, unknown>;
      if (raw && typeof raw === 'object') {
        for (const [chain, info] of Object.entries(raw)) {
          if (info && typeof info === 'object') {
            const i = info as Record<string, unknown>;
            entries.push({ chain, amount: typeof i.amount === 'string' ? i.amount : String(i.amount ?? '0'), token: typeof i.token === 'string' ? i.token : 'USDC' });
          }
        }
      }
      setBalances(entries);
    } catch (err) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Failed to fetch balances.' });
    } finally { setLoadingBal(false); }
  }

  async function handleDeposit() {
    if (!isPositiveDecimal(depositAmt)) return;
    setDepositing(true); setNotice(null);
    try {
      const adapter = await getAdapter(srcChain.id);
      await getAppKit().unifiedBalance.deposit({ from: { adapter, chain: srcChain.kit }, amount: depositAmt });
      setNotice({ type: 'success', text: `Deposited ${depositAmt} USDC from ${srcChain.label}.` });
      setDepositAmt('');
      await fetchBalances();
    } catch (err) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Deposit failed.' });
    } finally { setDepositing(false); }
  }

  async function handleSpend() {
    if (!isPositiveDecimal(spendAmt) || !isAddress(spendTo)) return;
    setSpending(true); setNotice(null);
    try {
      const adapter = await getAdapter(spendSrc.id);
      await getAppKit().unifiedBalance.spend({
        from: { adapter, allocations: { amount: spendAmt, chain: spendSrc.kit } },
        to: {
          chain: spendDst as unknown as typeof UnifiedBalanceChain[keyof typeof UnifiedBalanceChain],
          recipientAddress: spendTo,
          useForwarder: true,
        },
        amount: spendAmt,
      });
      setNotice({ type: 'success', text: `Spent ${spendAmt} USDC → ${spendDst} to ${spendTo.slice(0,6)}…${spendTo.slice(-4)}.` });
      setSpendAmt(''); setSpendTo('');
      await fetchBalances();
    } catch (err) {
      setNotice({ type: 'error', text: err instanceof Error ? err.message : 'Spend failed.' });
    } finally { setSpending(false); }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'balances', label: 'Balances' },
    { id: 'deposit',  label: 'Deposit' },
    { id: 'spend',    label: 'Spend' },
  ];

  return (
    <section className="glass-card overflow-hidden">
      {/* Header */}
      <div className="border-b px-5 py-4" style={{ borderColor: 'var(--border)' }}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Circle Gateway</p>
        <h3 className="display mt-1 text-xl font-semibold text-ink">Unified Balance</h3>
        <p className="mt-1 text-sm text-muted">Single USDC pool across multiple chains.</p>
      </div>

      {!isConnected ? (
        <div className="flex flex-col items-center gap-4 px-5 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'var(--surface-strong)' }}>
            <Wallet className="h-6 w-6 text-muted" />
          </div>
          <div>
            <p className="text-sm font-medium text-ink">Connect your wallet</p>
            <p className="mt-1 text-xs text-muted">To manage your unified balance across chains</p>
          </div>
          <ConnectButton showBalance={false} />
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex border-b" style={{ borderColor: 'var(--border)' }}>
            {tabs.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => { setTab(t.id); setNotice(null); }}
                className={`flex-1 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  tab === t.id
                    ? 'text-ink border-accent'
                    : 'text-muted border-transparent hover:text-ink'
                }`}
                style={ tab === t.id ? { borderBottomColor: 'var(--accent)' } : {} }
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-5 space-y-4">
            {notice && (
              <div className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm ${
                notice.type === 'success' ? 'border-success/25 bg-success/8 text-success' : 'border-danger/25 bg-danger/8 text-danger'
              }`}>
                {notice.type === 'success'
                  ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
                <span>{notice.text}</span>
              </div>
            )}

            {/* Balances tab */}
            {tab === 'balances' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-ink">Cross-chain USDC balances</p>
                  <button
                    type="button"
                    onClick={fetchBalances}
                    disabled={loadingBal}
                    className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40"
                    style={{ background: 'var(--surface-strong)', color: 'var(--muted)', border: '1px solid var(--border)' }}
                  >
                    <RefreshCw className={`h-3 w-3 ${loadingBal ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>
                {balances.length === 0 && !loadingBal && (
                  <div className="rounded-xl py-10 text-center" style={{ background: 'var(--surface-inner)', border: '1px solid var(--border)' }}>
                    <p className="text-sm text-muted">Click Refresh to load balances</p>
                  </div>
                )}
                {loadingBal && (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--accent)' }} />
                  </div>
                )}
                {!loadingBal && balances.map(b => (
                  <div key={b.chain} className="flex items-center justify-between rounded-xl px-3.5 py-3" style={{ background: 'var(--surface-inner)', border: '1px solid var(--border)' }}>
                    <span className="text-sm text-muted">{b.chain}</span>
                    <span className="mono text-sm font-semibold tabular-nums text-ink">
                      {Number(b.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })} {b.token}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Deposit tab */}
            {tab === 'deposit' && (
              <div className="space-y-4">
                <div>
                  <label className="block mb-1.5 text-[11px] font-semibold uppercase tracking-[0.10em] text-muted">Source chain</label>
                  <select
                    value={srcChain.id}
                    onChange={e => setSrcChain(SOURCE_CHAINS.find(c => c.id === Number(e.target.value))!)}
                    className="w-full rounded-xl px-3.5 py-2.5 text-sm text-ink outline-none"
                    style={{ background: 'var(--surface-inner)', border: '1px solid var(--border)', fontFamily: 'inherit', colorScheme: 'inherit' }}
                  >
                    {SOURCE_CHAINS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block mb-1.5 text-[11px] font-semibold uppercase tracking-[0.10em] text-muted">Amount (USDC)</label>
                  <div className="flex items-center gap-2 rounded-xl px-3.5 py-3" style={{ background: 'var(--surface-inner)', border: '1px solid var(--border)' }}>
                    <input
                      inputMode="decimal"
                      value={depositAmt}
                      onChange={e => setDepositAmt(e.target.value)}
                      placeholder="0.00"
                      className="display flex-1 bg-transparent text-2xl font-semibold tabular-nums text-ink placeholder:text-subtle outline-none"
                    />
                    <span className="mono text-sm font-medium text-muted">USDC</span>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!isPositiveDecimal(depositAmt) || depositing}
                  onClick={handleDeposit}
                  className="w-full rounded-2xl py-3.5 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
                >
                  {depositing ? <span className="flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Depositing…</span> : 'Deposit into Unified Balance'}
                </button>
              </div>
            )}

            {/* Spend tab */}
            {tab === 'spend' && (
              <div className="space-y-4">
                <div>
                  <label className="block mb-1.5 text-[11px] font-semibold uppercase tracking-[0.10em] text-muted">Allocate from chain</label>
                  <select
                    value={spendSrc.id}
                    onChange={e => setSpendSrc(SOURCE_CHAINS.find(c => c.id === Number(e.target.value))!)}
                    className="w-full rounded-xl px-3.5 py-2.5 text-sm text-ink outline-none"
                    style={{ background: 'var(--surface-inner)', border: '1px solid var(--border)', fontFamily: 'inherit', colorScheme: 'inherit' }}
                  >
                    {SOURCE_CHAINS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block mb-1.5 text-[11px] font-semibold uppercase tracking-[0.10em] text-muted">Destination chain</label>
                  <input
                    value={spendDst}
                    onChange={e => setSpendDst(e.target.value)}
                    placeholder="e.g. Arc_Testnet"
                    className="w-full rounded-xl px-3.5 py-2.5 text-sm text-ink placeholder:text-subtle outline-none"
                    style={{ background: 'var(--surface-inner)', border: '1px solid var(--border)' }}
                  />
                </div>
                <div>
                  <label className="block mb-1.5 text-[11px] font-semibold uppercase tracking-[0.10em] text-muted">Recipient address</label>
                  <input
                    value={spendTo}
                    onChange={e => setSpendTo(e.target.value)}
                    placeholder="0x..."
                    spellCheck={false}
                    className="mono w-full rounded-xl px-3.5 py-2.5 text-sm text-ink placeholder:text-subtle outline-none"
                    style={{ background: 'var(--surface-inner)', border: `1px solid ${spendTo && !isAddress(spendTo) ? 'var(--danger)' : 'var(--border)'}` }}
                  />
                  {spendTo && !isAddress(spendTo) && <p className="mt-1.5 text-xs" style={{ color: 'var(--danger)' }}>Invalid address</p>}
                </div>
                <div>
                  <label className="block mb-1.5 text-[11px] font-semibold uppercase tracking-[0.10em] text-muted">Amount (USDC)</label>
                  <div className="flex items-center gap-2 rounded-xl px-3.5 py-3" style={{ background: 'var(--surface-inner)', border: '1px solid var(--border)' }}>
                    <input
                      inputMode="decimal"
                      value={spendAmt}
                      onChange={e => setSpendAmt(e.target.value)}
                      placeholder="0.00"
                      className="display flex-1 bg-transparent text-2xl font-semibold tabular-nums text-ink placeholder:text-subtle outline-none"
                    />
                    <span className="mono text-sm font-medium text-muted">USDC</span>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!isPositiveDecimal(spendAmt) || !isAddress(spendTo) || spending}
                  onClick={handleSpend}
                  className="w-full rounded-2xl py-3.5 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ background: 'var(--success)', color: 'var(--success-fg)' }}
                >
                  {spending ? <span className="flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Spending…</span> : 'Spend from Unified Balance'}
                </button>
              </div>
            )}
          </div>

          <div className="px-5 py-3 border-t text-center text-[11px] text-subtle" style={{ borderColor: 'var(--border)' }}>
            Powered by Circle Gateway · Forwarding Service enabled
          </div>
        </>
      )}
    </section>
  );
}
