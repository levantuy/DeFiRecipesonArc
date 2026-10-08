'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, CheckCircle2, Settings2, TriangleAlert, Wallet } from 'lucide-react';
import { formatUnits } from 'viem';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useBalance } from 'wagmi';
import { CONTRACT_ADDRESSES } from '@/config/contracts';
import { estimateSwap, executeSwap } from '@/lib/appkit/swap-client';
import { useLanguage } from '@/lib/i18n/LanguageProvider';

type FxToken = 'USDC' | 'EURC';

type QuoteState =
  | { ok: true; amountOut: string; effectiveRate: string; appFeeBps: number; appFeeAmount: string }
  | { ok: false; error: string };

const SLIPPAGE_PRESETS_BPS = [10, 50, 100, 200] as const;
function otherToken(token: FxToken): FxToken {
  return token === 'USDC' ? 'EURC' : 'USDC';
}

function isPositiveDecimal(value: string): boolean {
  if (value.trim() === '') return false;
  return /^\d*\.?\d+$/.test(value) && Number(value) > 0;
}

function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2);
}

function formatAmount(value: string | number): string {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return '0';
  if (numeric >= 1000) return numeric.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return numeric.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function applySlippageFloor(value: string, bps: number): string {
  const numeric = Number(value || 0);
  const floor = numeric * (1 - bps / 10_000);
  return floor.toFixed(6);
}

async function recordSwapAction(input: {
  from: FxToken;
  to: FxToken;
  amountIn: string;
  slippageBps: number;
  minOut?: string;
  amountOut: string;
  txHash: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  void input;
  await new Promise((resolve) => setTimeout(resolve, 250));
  return { ok: true };
}

export function SwapPanel() {
  const { t } = useLanguage();
  const { address, isConnected, connector } = useAccount();
  const { data: usdcBalanceData } = useBalance({
    address: address,
    token: CONTRACT_ADDRESSES.usdc,
    query: { enabled: isConnected && !!address },
  });
  const { data: eurcBalanceData } = useBalance({
    address: address,
    token: CONTRACT_ADDRESSES.eurc,
    query: { enabled: isConnected && !!address },
  });

  const [from, setFrom] = useState<FxToken>('USDC');
  const to = otherToken(from);
  const [amountIn, setAmountIn] = useState('');
  const [slippageBps, setSlippageBps] = useState<number>(50);
  const [minOut, setMinOut] = useState('');
  const [minOutTouched, setMinOutTouched] = useState(false);
  const [quote, setQuote] = useState<QuoteState | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [flipping, setFlipping] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const requestId = useRef(0);
  const settingsRef = useRef<HTMLDivElement>(null);
  const appFeeBps = Number(process.env.NEXT_PUBLIC_APP_FEE_BPS ?? '25');
  const appFeeRecipient = (process.env.NEXT_PUBLIC_APP_FEE_RECIPIENT ?? '0x0000000000000000000000000000000000000000').trim();

  const balances = useMemo(() => {
    return {
      usdc: usdcBalanceData ? formatUnits(usdcBalanceData.value, usdcBalanceData.decimals) : '0',
      eurc: eurcBalanceData ? formatUnits(eurcBalanceData.value, eurcBalanceData.decimals) : '0',
    };
  }, [eurcBalanceData, usdcBalanceData]);

  const balanceFor = (token: FxToken) => (token === 'USDC' ? balances.usdc : balances.eurc);

  const insufficient = isPositiveDecimal(amountIn) && Number(amountIn) > Number(balanceFor(from));

  useEffect(() => {
    if (!isPositiveDecimal(amountIn)) {
      setQuote(null);
      setQuoting(false);
      return;
    }

    const id = ++requestId.current;
    const handle = window.setTimeout(async () => {
      try {
        setQuoting(true);
        const result = await estimateSwap({
          tokenIn: from,
          tokenOut: to,
          amountIn,
          connector: connector ?? undefined,
        });

        if (id !== requestId.current) return;

        const appFeeAmount = (Number(amountIn) * (appFeeBps / 10_000)).toFixed(6);
        const nextQuote = {
          ok: true as const,
          amountOut: result.amountOut,
          effectiveRate: result.effectiveRate,
          appFeeBps,
          appFeeAmount,
        };

        setQuote(nextQuote);
        if (!minOutTouched) {
          setMinOut(applySlippageFloor(nextQuote.amountOut, slippageBps));
        }
      } catch (error) {
        if (id !== requestId.current) return;
        setQuote({
          ok: false,
          error: error instanceof Error ? error.message : t('failedToFetchQuote'),
        });
      } finally {
        if (id === requestId.current) {
          setQuoting(false);
        }
      }
    }, 350);

    return () => window.clearTimeout(handle);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountIn, appFeeBps, from, minOutTouched, slippageBps, t, to]);

  useEffect(() => {
    if (!settingsOpen) return;

    function onPointerDown(event: MouseEvent) {
      if (settingsRef.current?.contains(event.target as Node)) return;
      setSettingsOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSettingsOpen(false);
      }
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [settingsOpen]);

  const canExecute =
    quote?.ok &&
    isConnected &&
    isPositiveDecimal(amountIn) &&
    !insufficient &&
    !quoting &&
    !executing;

  function flipTokens() {
    setFrom(to);
    setAmountIn('');
    setMinOut('');
    setMinOutTouched(false);
    setQuote(null);
    setNotice(null);
    setFlipping(true);
    window.setTimeout(() => setFlipping(false), 380);
  }

  async function onExecute() {
    if (!quote?.ok) return;
    setExecuting(true);
    setNotice(null);

    try {
      const result = await executeSwap({
        tokenIn: from,
        tokenOut: to,
        amountIn,
        slippageBps,
        stopLimit: isPositiveDecimal(minOut) ? minOut : undefined,
        appFeeBps: quote.appFeeBps,
        appFeeRecipient: appFeeRecipient,
        connector: connector ?? undefined,
      });

      const recorded = await recordSwapAction({
        from,
        to,
        amountIn,
        slippageBps,
        minOut: isPositiveDecimal(minOut) ? minOut : undefined,
        amountOut: result.amountOut ?? quote.amountOut,
        txHash: result.txHash ?? '',
      });

      setConfirmationOpen(false);
      setSettingsOpen(false);

      if (recorded.ok) {
        setNotice({ type: 'success', text: t('swapConfirmed') });
        setAmountIn('');
        setMinOut('');
        setMinOutTouched(false);
        setQuote(null);
      } else {
        setNotice({ type: 'error', text: recorded.error });
      }
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : t('swapExecutionFailed'),
      });
    } finally {
      setExecuting(false);
    }
  }

  const estimatedOut = quote?.ok ? formatAmount(quote.amountOut) : quoting ? '…' : '0';

  return (
    <section className="glass-card p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.22em]" style={{ color: 'var(--muted)' }}>{t('swapPanelEyebrow')}</p>
          <h3 className="mt-1 text-2xl font-bold" style={{ color: 'var(--ink)' }}>{t('swapPanelTitle')}</h3>
        </div>
        <div className="flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs" style={{ borderColor: 'var(--border)', background: 'var(--surface-muted)', color: 'var(--ink-2)' }}>
          <Wallet className="h-3.5 w-3.5 text-emerald-400" />
          <span>{isConnected ? t('walletConnected') : t('walletDisconnected')}</span>
        </div>
      </div>

      {notice ? (
        <div
          className="mb-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-sm"
          style={{
            borderColor: notice.type === 'success' ? 'rgba(111,207,151,0.30)' : 'rgba(235,87,87,0.30)',
            background: notice.type === 'success' ? 'var(--success-bg)' : 'var(--danger-bg)',
            color: notice.type === 'success' ? 'var(--success)' : 'var(--danger)',
          }}
        >
          {notice.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}
          <span>{notice.text}</span>
        </div>
      ) : null}

      <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface-inner)' }}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>{t('swapFormTitle')}</span>
            <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
              {isConnected ? t('externalWalletSource') : t('noWalletSource')}{' '}
              {address ? <span className="font-mono" style={{ color: 'var(--ink-2)' }}>{address.slice(0, 6)}…{address.slice(-4)}</span> : null}
            </span>
          </div>

          <div className="relative" ref={settingsRef}>
            <button
              type="button"
              aria-label={t('swapSettings')}
              aria-expanded={settingsOpen}
              aria-haspopup="dialog"
              onClick={() => setSettingsOpen((open) => !open)}
              className="flex h-8 w-8 items-center justify-center rounded-md transition-colors"
              style={{ color: 'var(--muted)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = ''; (e.currentTarget as HTMLButtonElement).style.color = 'var(--muted)'; }}
            >
              <Settings2 className="h-4 w-4" />
            </button>
            {settingsOpen ? (
              <div className="absolute right-0 top-11 z-20 w-72 rounded-xl border p-4 shadow-xl" style={{ borderColor: 'var(--border-strong)', background: 'var(--nav-bg-solid)' }}>
                <div className="space-y-2">
                  <label className="block text-[11px] font-medium uppercase tracking-[0.18em]" style={{ color: 'var(--muted)' }}>
                    {t('maxSlippageSwap')}
                  </label>
                  <select
                    value={String(slippageBps)}
                    onChange={(event) => setSlippageBps(Number(event.target.value))}
                    className="surface-input w-full px-3 py-2 text-sm font-medium"
                    style={{ colorScheme: 'inherit' }}
                  >
                    {SLIPPAGE_PRESETS_BPS.map((bps) => (
                      <option key={bps} value={String(bps)}>
                        {bpsToPercent(bps)}%
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mt-4 space-y-2">
                  <label className="block text-[11px] font-medium uppercase tracking-[0.18em]" style={{ color: 'var(--muted)' }}>
                    {t('minOutput')} ({to})
                  </label>
                  <input
                    inputMode="decimal"
                    value={minOut}
                    onChange={(event) => {
                      setMinOut(event.target.value);
                      setMinOutTouched(true);
                    }}
                    placeholder={t('floorPricePlaceholder')}
                    className="surface-input w-full px-3 py-2 text-sm"
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface-muted)' }}>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm" style={{ color: 'var(--muted)' }}>{t('sell')}</span>
            <button
              type="button"
              className="text-xs underline-offset-4 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              style={{ color: 'var(--ink-2)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink)'; (e.currentTarget as HTMLButtonElement).style.textDecoration = 'underline'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink-2)'; (e.currentTarget as HTMLButtonElement).style.textDecoration = ''; }}
              disabled={Number(balanceFor(from)) === 0}
              onClick={() => setAmountIn(String(balanceFor(from)))}
            >
              {t('max')}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <input
              inputMode="decimal"
              value={amountIn}
              placeholder="0"
              disabled={Number(balanceFor(from)) === 0}
              onChange={(event) => {
                const value = event.target.value;
                const balance = balanceFor(from);
                const capped = isPositiveDecimal(value) && Number(value) > Number(balance) ? balance : value;
                setAmountIn(capped);
                setMinOutTouched(false);
              }}
              className="min-w-0 flex-1 bg-transparent text-3xl font-semibold outline-none disabled:cursor-not-allowed"
              style={{ color: 'var(--ink)' }}
            />

            <select
              value={from}
              onChange={(event) => setFrom(event.target.value as FxToken)}
              className="surface-input h-10 shrink-0 rounded-full px-3 text-sm font-medium"
              style={{ colorScheme: 'inherit' }}
            >
              <option value="USDC">USDC</option>
              <option value="EURC">EURC</option>
            </select>
          </div>

          <div className="mt-3 flex items-center justify-between text-xs" style={{ color: 'var(--muted)' }}>
            <span className="tabular-nums">{t('swapBalance')}: {formatAmount(balanceFor(from))}</span>
            {insufficient ? <span style={{ color: 'var(--danger)' }}>{t('insufficientBalance')}</span> : null}
          </div>
        </div>

        <div className="relative z-10 flex justify-center -my-2">
          <button
            type="button"
            onClick={flipTokens}
            className="flex h-9 w-9 items-center justify-center rounded-xl border transition-colors"
            style={{ borderColor: 'var(--border-strong)', background: 'var(--surface-muted)', color: 'var(--ink-2)', boxShadow: '0 0 0 5px var(--bg)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-strong)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-muted)'; }}
          >
            <ArrowDown
              className="h-4 w-4"
              style={flipping ? { animation: 'flip-cw 380ms cubic-bezier(0.4, 0, 0.2, 1)' } : undefined}
            />
          </button>
        </div>

        <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface-muted)' }}>
          <span className="text-sm" style={{ color: 'var(--muted)' }}>{t('buy')}</span>
          <div className="mt-3 flex items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-3xl font-semibold tabular-nums" style={{ color: 'var(--ink-2)' }}>
              {estimatedOut}
            </span>
            <div className="flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium" style={{ borderColor: 'var(--border)', background: 'var(--surface-inner)', color: 'var(--ink)' }}>
              {to}
            </div>
          </div>
          <div className="mt-3 text-xs tabular-nums" style={{ color: 'var(--muted)' }}>{t('swapBalance')}: {formatAmount(balanceFor(to))}</div>
        </div>

        {quote?.ok ? (
          <div className="mt-3 rounded-xl border px-4 py-3 text-xs" style={{ borderColor: 'var(--border)', background: 'var(--surface-inner)', color: 'var(--ink-2)' }}>
            <div className="flex items-center justify-between">
              <span>{t('rate')}</span>
              <span className="tabular-nums" style={{ color: 'var(--ink)' }}>
                1 {from} ≈ {Number(quote.effectiveRate).toFixed(6)} {to}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span>{t('appFee')}</span>
              <span className="tabular-nums" style={{ color: 'var(--ink)' }}>
                {formatAmount(quote.appFeeAmount)} {from} ({bpsToPercent(quote.appFeeBps)}%)
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span>{t('slippage')}</span>
              <span style={{ color: 'var(--ink)' }}>{bpsToPercent(slippageBps)}%</span>
            </div>
          </div>
        ) : null}

        {!quote?.ok && quote?.error ? (
          <div className="mt-3 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: 'rgba(235,87,87,0.30)', background: 'var(--danger-bg)', color: 'var(--danger)' }}>
            {quote.error}
          </div>
        ) : null}

        {!isConnected ? (
          <div className="mt-3 rounded-xl border px-3 py-2 text-xs" style={{ borderColor: 'var(--border)', background: 'var(--surface-inner)', color: 'var(--ink-2)' }}>
            {t('connectWalletBeforeSwapping')}
          </div>
        ) : null}

        <div className="mt-4">
          {!isConnected ? (
            <ConnectButton showBalance={false} />
          ) : (
            <button
              type="button"
              className="h-12 w-full rounded-xl bg-blue-600 text-base font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canExecute}
              onClick={() => setConfirmationOpen(true)}
            >
              {executing
                ? `${t('activating')}`
                : Number(balanceFor(from)) === 0
                  ? `${t('getTokenFromFaucet')} ${from}`
                  : `${t('swapFormTitle')} ${from} → ${to}`}
            </button>
          )}
        </div>
      </div>

      {confirmationOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)' }}>
          <div className="w-full max-w-md rounded-2xl border p-5 shadow-2xl" style={{ borderColor: 'var(--border-strong)', background: 'var(--nav-bg-solid)' }}>
            <div className="mb-4">
              <h4 className="text-xl font-bold" style={{ color: 'var(--ink)' }}>{t('confirmSwap')}</h4>
              <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>{t('reviewQuoteFinal')}</p>
            </div>

            <dl className="space-y-2 text-sm" style={{ color: 'var(--ink-2)' }}>
              <div className="flex items-center justify-between">
                <dt style={{ color: 'var(--muted)' }}>{t('pay')}</dt>
                <dd className="tabular-nums" style={{ color: 'var(--ink)' }}>{formatAmount(amountIn || '0')} {from}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt style={{ color: 'var(--muted)' }}>{t('receiveEstimated')}</dt>
                <dd className="tabular-nums" style={{ color: 'var(--ink)' }}>{quote?.ok ? `${formatAmount(quote.amountOut)} ${to}` : '-'}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt style={{ color: 'var(--muted)' }}>{t('minOutput')}</dt>
                <dd className="tabular-nums" style={{ color: 'var(--ink)' }}>
                  {isPositiveDecimal(minOut) ? `${formatAmount(minOut)} ${to}` : '-' }
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt style={{ color: 'var(--muted)' }}>{t('slippage')}</dt>
                <dd style={{ color: 'var(--ink)' }}>{bpsToPercent(slippageBps)}%</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt style={{ color: 'var(--muted)' }}>{t('appFee')}</dt>
                <dd className="tabular-nums" style={{ color: 'var(--ink)' }}>
                  {quote?.ok
                    ? `${formatAmount(quote.appFeeAmount)} ${from} (${bpsToPercent(quote.appFeeBps)}%)`
                    : '-'}
                </dd>
              </div>
            </dl>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmationOpen(false)}
                disabled={executing}
                className="rounded-lg border px-4 py-2 text-sm font-medium transition disabled:opacity-50"
                style={{ borderColor: 'var(--border)', background: 'var(--surface-inner)', color: 'var(--ink-2)' }}
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={onExecute}
                disabled={executing}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
              >
                {executing ? `${t('activating')}` : t('swapConfirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
