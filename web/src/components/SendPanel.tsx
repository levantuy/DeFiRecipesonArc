'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, Loader2, TriangleAlert } from 'lucide-react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useBalance, useChainId, useSwitchChain, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits, isAddress } from 'viem';
import { CONTRACT_ADDRESSES, ARC_TESTNET_CHAIN_ID } from '@/config/contracts';

const USDC_TRANSFER_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to',    type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

const EXPLORER = 'https://testnet.arcscan.app';

function fmtBalance(v: string | number): string {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export function SendPanel() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();

  const { data: balanceData } = useBalance({
    address,
    token: CONTRACT_ADDRESSES.usdc,
    query: { enabled: isConnected && !!address },
  });

  const [recipient, setRecipient] = useState('');
  const [amount,    setAmount]    = useState('');
  const [notice,    setNotice]    = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [switching, setSwitching] = useState(false);

  const { writeContract, data: txHash, isPending, error: writeError, reset: resetWrite } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  const balance    = balanceData ? Number(balanceData.value) / 10 ** balanceData.decimals : 0;
  const amountNum  = Number(amount);
  const isOnArc    = chainId === ARC_TESTNET_CHAIN_ID;

  const recipientValid = isAddress(recipient);
  const amountValid    = /^\d*\.?\d+$/.test(amount.trim()) && amountNum > 0;
  const sufficientBal  = amountValid && amountNum <= balance;
  const canSend        = isConnected && recipientValid && amountValid && sufficientBal && !isPending && !isConfirming;

  useEffect(() => {
    if (writeError) setNotice({ type: 'error', text: writeError.message.split('\n')[0] });
  }, [writeError]);

  useEffect(() => {
    if (isConfirmed && txHash) {
      setNotice({ type: 'success', text: `Sent ${amount} USDC successfully.` });
      setAmount('');
      setRecipient('');
      resetWrite();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed, txHash]);

  async function handleSend() {
    if (!canSend) return;
    setNotice(null);

    if (!isOnArc) {
      setSwitching(true);
      try {
        await switchChainAsync({ chainId: ARC_TESTNET_CHAIN_ID });
      } catch {
        setNotice({ type: 'error', text: 'Switch to Arc Testnet failed.' });
        setSwitching(false);
        return;
      }
      setSwitching(false);
    }

    writeContract({
      address: CONTRACT_ADDRESSES.usdc,
      abi: USDC_TRANSFER_ABI,
      functionName: 'transfer',
      args: [recipient as `0x${string}`, parseUnits(amount, 6)],
    });
  }

  const busy = isPending || isConfirming || switching;

  return (
    <section className="glass-card overflow-hidden">
      {/* Header */}
      <div className="border-b px-5 py-4" style={{ borderColor: 'var(--border)' }}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Same-chain transfer</p>
        <h3 className="display mt-1 text-xl font-semibold text-ink">Send USDC</h3>
        <p className="mt-1 text-sm text-muted">Transfer USDC to any address on Arc Testnet.</p>
      </div>

      <div className="p-5 space-y-4">
        {/* Chain warning */}
        {!isOnArc && isConnected && (
          <div className="flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm" style={{ borderColor: 'rgba(242,153,74,0.30)', background: 'var(--warning-bg)', color: 'var(--warning)' }}>
            <TriangleAlert className="h-4 w-4 shrink-0" />
            <span>Not on Arc Testnet — will switch automatically.</span>
          </div>
        )}

        {/* Notice */}
        {notice && (
          <div className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm ${
            notice.type === 'success' ? 'border-success/25 bg-success/8 text-success' : 'border-danger/25 bg-danger/8 text-danger'
          }`}>
            {notice.type === 'success'
              ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
            <div className="flex-1 min-w-0">
              <span>{notice.text}</span>
              {notice.type === 'success' && txHash && (
                <a
                  href={`${EXPLORER}/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 flex items-center gap-1 text-xs underline"
                  style={{ color: 'var(--accent)' }}
                >
                  <ExternalLink className="h-3 w-3" />
                  View on ArcScan
                </a>
              )}
            </div>
          </div>
        )}

        {/* Recipient */}
        <div>
          <label className="block mb-1.5 text-[11px] font-semibold uppercase tracking-[0.10em] text-muted">Recipient</label>
          <input
            value={recipient}
            onChange={e => { setRecipient(e.target.value); setNotice(null); }}
            placeholder="0x..."
            spellCheck={false}
            className="mono w-full rounded-xl px-3.5 py-2.5 text-sm text-ink placeholder:text-subtle outline-none"
            style={{ background: 'var(--surface-inner)', border: `1px solid ${recipient && !recipientValid ? 'var(--danger)' : 'var(--border)'}` }}
          />
          {recipient && !recipientValid && (
            <p className="mt-1.5 text-xs" style={{ color: 'var(--danger)' }}>Invalid address</p>
          )}
        </div>

        {/* Amount */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-[0.10em] text-muted">Amount</label>
            <button
              type="button"
              disabled={balance === 0}
              onClick={() => setAmount(String(balance))}
              className="text-xs font-medium transition-colors disabled:opacity-40"
              style={{ color: 'var(--accent)' }}
            >
              Balance: {fmtBalance(balance)} · Max
            </button>
          </div>
          <div className={`flex items-center gap-2 rounded-xl px-3.5 py-3 ${amountValid && !sufficientBal ? 'border-danger/60' : ''}`}
            style={{ background: 'var(--surface-inner)', border: `1px solid ${amountValid && !sufficientBal ? 'var(--danger)' : 'var(--border)'}` }}
          >
            <input
              inputMode="decimal"
              value={amount}
              onChange={e => { setAmount(e.target.value); setNotice(null); }}
              placeholder="0.00"
              className="display flex-1 bg-transparent text-2xl font-semibold tabular-nums text-ink placeholder:text-subtle outline-none"
            />
            <span className="mono text-sm font-medium text-muted shrink-0">USDC</span>
          </div>
          {amountValid && !sufficientBal && (
            <p className="mt-1.5 text-xs" style={{ color: 'var(--danger)' }}>Insufficient balance</p>
          )}
        </div>

        {/* Summary */}
        {recipientValid && amountValid && sufficientBal && (
          <div className="rounded-xl p-3.5 space-y-2" style={{ background: 'var(--surface-inner)', border: '1px solid var(--border)' }}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.10em] text-muted mb-2.5">Review</p>
            {[
              ['Sending',  `${amount} USDC`],
              ['To',       `${recipient.slice(0,6)}…${recipient.slice(-4)}`],
              ['Network',  'Arc Testnet'],
              ['Gas',      'Paid in USDC'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm">
                <span className="text-muted">{k}</span>
                <span className="mono text-ink font-medium">{v}</span>
              </div>
            ))}
          </div>
        )}

        {/* CTA */}
        {!isConnected ? (
          <ConnectButton showBalance={false} />
        ) : (
          <button
            type="button"
            disabled={!canSend || busy}
            onClick={handleSend}
            className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            {busy
              ? <><Loader2 className="h-4 w-4 animate-spin" />{switching ? 'Switching…' : isConfirming ? 'Confirming…' : 'Sending…'}</>
              : 'Send USDC'}
          </button>
        )}
      </div>

      <div className="px-5 py-3 border-t text-center text-[11px] text-subtle" style={{ borderColor: 'var(--border)' }}>
        Arc Testnet · USDC as gas · Get test USDC from the sidebar faucet
      </div>
    </section>
  );
}
