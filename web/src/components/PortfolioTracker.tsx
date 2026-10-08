'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Wallet, ArrowUpRight, History, CheckCircle, Clock, AlertTriangle, ExternalLink, ChevronLeft, ChevronRight, RefreshCw, Code2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { formatUnits } from 'viem';
import { useAccount, useBalance } from 'wagmi';

import { CONTRACT_ADDRESSES } from '../config/contracts';
import { formatUsdcDecimal } from '@/lib/dcaConfig';
import { useLanguage } from '@/lib/i18n/LanguageProvider';

interface AuditLog {
  id: string;
  recipeName: string;
  userAddress: string;
  txHash: `0x${string}` | null;
  timestampRelative: string;
  timestampIso: string;
  timestampMs: number;
  status: 'CONFIRMED' | 'SUBMITTED' | 'REVERTED' | 'SIMULATING' | 'SIMULATION_FAILED';
  gasUsedUsdc: string | null;
  errorMessage?: string | null;
}

interface ApiAuditLogItem {
  id: string;
  recipeType: string;
  userAddress: string;
  txHash: string | null;
  timestamp: string;
  timestampIso: string;
  status: 'CONFIRMED' | 'SUBMITTED' | 'REVERTED' | 'SIMULATING' | 'SIMULATION_FAILED';
  gasUsedUsdc: string | null;
  errorMessage?: string | null;
}

type StatusFilter = 'ALL' | AuditLog['status'];
type SortMode = 'NEWEST' | 'OLDEST' | 'STATUS';
const VALID_STATUS_FILTERS: StatusFilter[] = ['ALL', 'CONFIRMED', 'SUBMITTED', 'REVERTED', 'SIMULATING', 'SIMULATION_FAILED'];
const VALID_SORT_MODES: SortMode[] = ['NEWEST', 'OLDEST', 'STATUS'];
const DEFAULT_PAGE_SIZE = 10;
const LOGS_AUTO_REFRESH_INTERVAL_MS = 15_000;

interface LogsPageResponse {
  success?: boolean;
  logs?: ApiAuditLogItem[];
  total?: number;
  page?: number;
  pageSize?: number;
  hasMore?: boolean;
  error?: string;
}

const RECIPE_NAME_BY_TYPE: Record<string, string> = {
  AUTO_COMPOUNDER: 'USDC Yield Auto-Compounder',
  RECURRING_DCA: 'USDC -> EURC Recurring DCA',
  SAFETY_NET: 'USDC Safety Net',
  SAVINGS_STREAM: 'USDC Savings Stream',
};

function toRecipeName(recipeType: string): string {
  return RECIPE_NAME_BY_TYPE[recipeType] || recipeType;
}

function toStatusClasses(status: AuditLog['status']): string {
  if (status === 'CONFIRMED') {
    return 'bg-emerald-950 border-emerald-800 text-emerald-400';
  }
  if (status === 'SUBMITTED' || status === 'SIMULATING') {
    return 'bg-amber-950 border-amber-800 text-amber-400';
  }
  return 'bg-rose-950 border-rose-800 text-rose-400';
}

function toRelativeTimeClient(timestampMs: number, nowMs: number = Date.now()): string {
  const diffMs = nowMs - timestampMs;
  if (diffMs < 0) return 'just now';
  if (diffMs < 60_000) return 'just now';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function formatAbsoluteTimestamp(isoTimestamp: string, locale: string): string {
  const parsed = Date.parse(isoTimestamp);
  if (!Number.isFinite(parsed)) {
    return locale === 'vi-VN' ? 'Không có' : 'N/A';
  }
  return new Date(parsed).toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function splitUsdDisplay(value: number, fractionDigits: number, locale: string): { whole: string; fraction: string } {
  const normalized = Number.isFinite(value) ? Math.max(0, value) : 0;
  const [whole = '0', fraction = '00'] = normalized
    .toLocaleString(locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    })
    .split('.');

  return { whole, fraction };
}

function parseGasUsedUsdc(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Number(value.replace(/\s*USDC\s*$/i, '').trim());
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return parsed;
}

function formatGasUsedUsdc(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = parseGasUsedUsdc(value);
  return `${normalized.toFixed(6)} USDC`;
}

const PortfolioTrackerContent: React.FC = () => {
  const { lang, t } = useLanguage();
  const locale = lang === 'vi' ? 'vi-VN' : 'en-US';
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const safePathname = pathname || '/';
  const safeSearchParams = useMemo(
    () => (searchParams ? new URLSearchParams(searchParams.toString()) : new URLSearchParams()),
    [searchParams]
  );
  const { address } = useAccount();
  const { data: usdcBalanceData, isLoading: isLoadingUsdcBalance } = useBalance({
    address,
    token: CONTRACT_ADDRESSES.usdc,
    query: {
      enabled: Boolean(address),
      refetchInterval: 15_000,
    },
  });
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(true);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(DEFAULT_PAGE_SIZE);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const isMountedRef = useRef(true);
  const activeLogsRequestRef = useRef(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    const queryStatus = (safeSearchParams.get('status') || 'ALL').toUpperCase() as StatusFilter;
    return VALID_STATUS_FILTERS.includes(queryStatus) ? queryStatus : 'ALL';
  });
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    const querySort = (safeSearchParams.get('sort') || 'NEWEST').toUpperCase() as SortMode;
    return VALID_SORT_MODES.includes(querySort) ? querySort : 'NEWEST';
  });

  useEffect(() => {
    const queryStatus = (safeSearchParams.get('status') || 'ALL').toUpperCase() as StatusFilter;
    const querySort = (safeSearchParams.get('sort') || 'NEWEST').toUpperCase() as SortMode;

    const nextStatus = VALID_STATUS_FILTERS.includes(queryStatus) ? queryStatus : 'ALL';
    const nextSort = VALID_SORT_MODES.includes(querySort) ? querySort : 'NEWEST';

    setStatusFilter(nextStatus);
    setSortMode(nextSort);
  }, [safeSearchParams]);

  useEffect(() => {
    const nextParams = new URLSearchParams(safeSearchParams.toString());

    nextParams.delete('userAddress');

    if (statusFilter !== 'ALL') {
      nextParams.set('status', statusFilter);
    } else {
      nextParams.delete('status');
    }

    if (sortMode !== 'NEWEST') {
      nextParams.set('sort', sortMode);
    } else {
      nextParams.delete('sort');
    }

    const nextQuery = nextParams.toString();
    const currentQuery = safeSearchParams.toString();
    if (nextQuery !== currentQuery) {
      router.replace(nextQuery ? `${safePathname}?${nextQuery}` : safePathname, { scroll: false });
    }
  }, [router, safePathname, safeSearchParams, sortMode, statusFilter]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, sortMode]);

  const fetchAuditLogs = useCallback(async (options?: { silent?: boolean }) => {
    const isSilentRefresh = options?.silent === true;
    const requestId = activeLogsRequestRef.current + 1;
    activeLogsRequestRef.current = requestId;

    const canCommitState = (): boolean => isMountedRef.current && activeLogsRequestRef.current === requestId;

    if (!isSilentRefresh) {
      setIsLoadingLogs(true);
    }

    try {
      if (!address) {
        if (canCommitState()) {
          setAuditLogs([]);
          setLogsError(null);
          setTotalCount(0);
          setHasMore(false);
        }
        return;
      }

      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String((page - 1) * pageSize),
        userAddress: address.toLowerCase(),
        sort: sortMode,
      });

      if (statusFilter !== 'ALL') {
        params.set('status', statusFilter);
      }

      const response = await fetch(`/api/logs?${params.toString()}`, {
        method: 'GET',
        cache: 'no-store',
      });
      const payload = (await response.json().catch(() => null)) as LogsPageResponse | null;

      if (!response.ok || !payload?.success || !Array.isArray(payload.logs)) {
        throw new Error(payload?.error || `Failed to load logs (${response.status}).`);
      }

      const mappedLogs: AuditLog[] = payload.logs.map((item) => ({
        timestampMs: Date.parse(item.timestampIso),
        id: item.id,
        recipeName: toRecipeName(item.recipeType),
        userAddress: item.userAddress,
        txHash: item.txHash && item.txHash.startsWith('0x') ? (item.txHash as `0x${string}`) : null,
        timestampRelative: item.timestamp,
        timestampIso: item.timestampIso,
        status: item.status,
        gasUsedUsdc: item.gasUsedUsdc,
        errorMessage: item.errorMessage || null,
      }));

      if (!canCommitState()) {
        return;
      }

      const nextTotal = Number.isFinite(payload.total) ? Number(payload.total) : mappedLogs.length;
      const nextPage = Number.isFinite(payload.page) ? Number(payload.page) : page;
      const nextHasMore = typeof payload.hasMore === 'boolean'
        ? payload.hasMore
        : nextPage * pageSize < nextTotal;

      setAuditLogs(mappedLogs);
      setTotalCount(Math.max(0, nextTotal));
      setHasMore(nextHasMore);
      setLogsError(null);
      if (nextPage > 1 && nextPage > Math.max(1, Math.ceil(nextTotal / pageSize))) {
        setPage(Math.max(1, Math.ceil(nextTotal / pageSize)));
      }
    } catch (error: unknown) {
      if (canCommitState()) {
        const message = error instanceof Error ? error.message : 'Unknown logs fetch error.';
        setLogsError(message);
        setAuditLogs([]);
        setTotalCount(0);
        setHasMore(false);
      }
    } finally {
      if (canCommitState()) {
        setIsLoadingLogs(false);
      }
    }
  }, [address, page, pageSize, sortMode, statusFilter]);

  useEffect(() => {
    void fetchAuditLogs();
  }, [fetchAuditLogs]);

  useEffect(() => {
    if (!address) {
      return;
    }

    const refreshTimerId = window.setInterval(() => {
      void fetchAuditLogs({ silent: true });
    }, LOGS_AUTO_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(refreshTimerId);
    };
  }, [address, fetchAuditLogs]);

  const visibleLogs = useMemo(() => {
    const filtered = statusFilter === 'ALL'
      ? auditLogs
      : auditLogs.filter((log) => log.status === statusFilter);

    const sorted = [...filtered];

    if (sortMode === 'STATUS') {
      const statusPriority: Record<AuditLog['status'], number> = {
        SIMULATION_FAILED: 0,
        REVERTED: 1,
        SIMULATING: 2,
        SUBMITTED: 3,
        CONFIRMED: 4,
      };

      sorted.sort((a, b) => {
        const priorityDelta = statusPriority[a.status] - statusPriority[b.status];
        if (priorityDelta !== 0) {
          return priorityDelta;
        }
        return b.timestampMs - a.timestampMs;
      });

      return sorted;
    }

    sorted.sort((a, b) => a.timestampMs - b.timestampMs);
    if (sortMode === 'NEWEST') {
      sorted.reverse();
    }

    return sorted;
  }, [auditLogs, sortMode, statusFilter]);

  const totalPages = useMemo(() => {
    if (totalCount <= 0) {
      return 1;
    }
    return Math.max(1, Math.ceil(totalCount / pageSize));
  }, [pageSize, totalCount]);

  const canGoPrevious = page > 1 && !isLoadingLogs;
  const canGoNext = page < totalPages && !isLoadingLogs && (hasMore || page * pageSize < totalCount);

  const activeRecipeCount = useMemo(() => {
    const activeStatuses: AuditLog['status'][] = ['CONFIRMED', 'SUBMITTED', 'SIMULATING'];
    return auditLogs.filter((log) => activeStatuses.includes(log.status)).length;
  }, [auditLogs]);

  const totalGasUsedUsdc = useMemo(() => {
    return auditLogs.reduce((sum, log) => sum + parseGasUsedUsdc(log.gasUsedUsdc), 0);
  }, [auditLogs]);

  const totalUsdcBalance = useMemo(() => {
    if (!usdcBalanceData) {
      return null;
    }
    return formatUnits(usdcBalanceData.value, usdcBalanceData.decimals);
  }, [usdcBalanceData]);

  const totalUsdcBalanceDisplay = useMemo(() => {
    if (totalUsdcBalance === null) {
      return { whole: '--', fraction: '--' };
    }
    const formatted = formatUsdcDecimal(totalUsdcBalance, { locale, maximumFractionDigits: 2 });
    const separator = locale === 'vi-VN' ? ',' : '.';
    const [whole = '0', fraction = '00'] = formatted.split(separator);
    return { whole, fraction: fraction.padEnd(2, '0') };
  }, [locale, totalUsdcBalance]);

  const totalGasUsedDisplay = useMemo(() => splitUsdDisplay(totalGasUsedUsdc, 2, locale), [locale, totalGasUsedUsdc]);

  return (
    <div className="space-y-6">
      {/* Deployed Contracts — collapsible detail */}
      <details className="group glass-card overflow-hidden">
        <summary className="flex cursor-pointer select-none list-none items-center justify-between px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-6 w-6 items-center justify-center rounded-md" style={{ background: 'rgba(172,198,233,0.10)' }}>
              <Code2 className="h-3.5 w-3.5" style={{ color: 'var(--accent)' }} />
            </div>
            <span className="mono text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
              Arc Testnet Contracts
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
              style={{ borderColor: 'rgba(111,207,151,0.25)', background: 'rgba(111,207,151,0.08)', color: 'var(--success)' }}>
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              Live
            </span>
          </div>
          <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" style={{ color: 'var(--subtle)' }} />
        </summary>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 border-t px-5 py-4" style={{ borderColor: 'var(--border)' }}>
          {[
            { label: t('sessionKeyRegistryLabel'), addr: CONTRACT_ADDRESSES.sessionKeyRegistry },
            { label: t('recipeGuardrailLabel'),    addr: CONTRACT_ADDRESSES.recipeGuardrail },
            { label: t('sharedExecutorProxyLabel'), addr: CONTRACT_ADDRESSES.sharedExecutorProxy },
          ].map(({ label, addr }) => (
            <div key={addr} className="rounded-xl p-3 space-y-1" style={{ background: 'var(--surface-inner)', border: '1px solid var(--border)' }}>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>{label}</div>
              <a href={`https://testnet.arcscan.app/address/${addr}`} target="_blank" rel="noopener noreferrer"
                className="mono flex items-center gap-1 text-[11px] hover:underline" style={{ color: 'var(--accent)' }}>
                <span className="truncate">{addr.slice(0, 18)}…{addr.slice(-4)}</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            </div>
          ))}
        </div>
      </details>

      {/* Portfolio Header Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.10em] text-muted">{t('balance')}</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: 'rgba(172,198,233,0.10)' }}>
              <Wallet className="h-3.5 w-3.5" style={{ color: 'var(--accent)' }} />
            </div>
          </div>
          <div className="display text-3xl font-bold tabular-nums text-ink">
            ${totalUsdcBalanceDisplay.whole}<span className="text-xl text-muted">.{totalUsdcBalanceDisplay.fraction}</span>
          </div>
          <div className="mt-2 flex items-center gap-1 text-xs" style={{ color: 'var(--success)' }}>
            <ArrowUpRight className="h-3.5 w-3.5" />
            <span>{isLoadingUsdcBalance ? t('refreshingBalance') : address ? t('liveBalance') : t('connectWalletBalance')}</span>
          </div>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.10em] text-muted">{t('activeRecipes')}</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: 'rgba(111,207,151,0.10)' }}>
              <Clock className="h-3.5 w-3.5" style={{ color: 'var(--success)' }} />
            </div>
          </div>
          <div className="display text-3xl font-bold tabular-nums text-ink">
            {activeRecipeCount} <span className="text-sm font-normal text-muted">{t('recipesRunning')}</span>
          </div>
          <div className="mt-2 text-xs text-muted">{t('scopedAuthorization')}</div>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.10em] text-muted">{t('cumulativeGas')}</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: 'rgba(172,198,233,0.08)' }}>
              <CheckCircle className="h-3.5 w-3.5" style={{ color: 'var(--accent)' }} />
            </div>
          </div>
          <div className="display text-3xl font-bold tabular-nums text-ink">
            ${totalGasUsedDisplay.whole}<span className="text-xl text-muted">.{totalGasUsedDisplay.fraction}</span>
          </div>
          <div className="mt-2 text-xs text-muted">{t('gasSummary')}</div>
        </div>
      </div>

      {/* Execution Audit Log */}
      <div className="glass-card overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: 'rgba(172,198,233,0.10)' }}>
              <History className="h-3.5 w-3.5" style={{ color: 'var(--accent)' }} />
            </div>
            <h3 className="display text-base font-semibold text-ink">{t('auditLogs')}</h3>
            {totalCount > 0 && (
              <span className="mono rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                style={{ borderColor: 'var(--border)', background: 'var(--surface-inner)', color: 'var(--muted)' }}>
                {totalCount}
              </span>
            )}
          </div>
          {/* Auto-refresh indicator */}
          <div className="flex items-center gap-1.5 text-[10px] font-mono" style={{ color: 'var(--subtle)' }}>
            <RefreshCw className="h-3 w-3 animate-spin" style={{ animationDuration: '3s' }} />
            15s
          </div>
        </div>

        {/* Filter + sort controls */}
        <div className="flex flex-wrap gap-3 px-5 py-3 border-b" style={{ borderColor: 'var(--border)', background: 'var(--surface-inner)' }}>
          <div className="flex items-center gap-2">
            <label htmlFor="audit-status-filter" className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--subtle)' }}>
              {t('statusFilter')}
            </label>
            <select id="audit-status-filter" value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold focus:outline-none"
              style={{ borderColor: 'var(--border)', background: 'var(--surface-muted)', color: 'var(--ink)', colorScheme: 'dark' }}>
              <option value="ALL">All</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="SUBMITTED">Submitted</option>
              <option value="SIMULATING">Simulating</option>
              <option value="REVERTED">Reverted</option>
              <option value="SIMULATION_FAILED">Sim Failed</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="audit-sort-mode" className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--subtle)' }}>
              {t('sortMode')}
            </label>
            <select id="audit-sort-mode" value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
              className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold focus:outline-none"
              style={{ borderColor: 'var(--border)', background: 'var(--surface-muted)', color: 'var(--ink)', colorScheme: 'dark' }}>
              <option value="NEWEST">{t('newest')}</option>
              <option value="OLDEST">{t('oldest')}</option>
              <option value="STATUS">{t('statusPriority')}</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" style={{ color: 'var(--ink-2)' }}>
            <thead style={{ background: 'var(--surface-inner)', borderBottom: '1px solid var(--border)' }}>
              <tr>
                {[t('recipe'), t('status'), t('transactionHash'), t('gasFee'), t('timestamp')].map((h) => (
                  <th key={h} className="mono px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap"
                    style={{ color: 'var(--subtle)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoadingLogs && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-xs" style={{ color: 'var(--subtle)' }}>
                    <div className="flex items-center justify-center gap-2">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      {t('loadingLogs')}
                    </div>
                  </td>
                </tr>
              )}
              {!isLoadingLogs && logsError && (
                <tr>
                  <td colSpan={5} className="px-5 py-6 text-xs" style={{ color: 'var(--danger)' }}>
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      {logsError}
                    </div>
                  </td>
                </tr>
              )}
              {!isLoadingLogs && !logsError && auditLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-xs" style={{ color: 'var(--subtle)' }}>
                    {address ? t('noLogs') : t('connectWalletBalance')}
                  </td>
                </tr>
              )}
              {!isLoadingLogs && !logsError && auditLogs.length > 0 && visibleLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-6 text-center text-xs" style={{ color: 'var(--subtle)' }}>
                    {t('noMatchingLogs')}
                  </td>
                </tr>
              )}
              {!isLoadingLogs && !logsError && visibleLogs.map((log, i) => (
                <tr key={log.id}
                  className="transition-colors"
                  style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-inner)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                >
                  {/* Recipe name */}
                  <td className="px-5 py-3.5 text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--ink)' }}>
                    {log.recipeName}
                  </td>
                  {/* Status badge */}
                  <td className="px-5 py-3.5">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${toStatusClasses(log.status)}`}>
                      {log.status === 'CONFIRMED' ? <CheckCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                      {log.status}
                    </span>
                  </td>
                  {/* Tx hash */}
                  <td className="px-5 py-3.5">
                    {log.txHash ? (
                      <a href={`https://testnet.arcscan.app/tx/${log.txHash}`} target="_blank" rel="noopener noreferrer"
                        className="mono inline-flex items-center gap-1 text-[11px] hover:underline" style={{ color: 'var(--accent)' }}>
                        {log.txHash.slice(0, 10)}…{log.txHash.slice(-6)}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="text-[11px]" style={{ color: 'var(--subtle)' }}>{t('na')}</span>
                    )}
                  </td>
                  {/* Gas */}
                  <td className="px-5 py-3.5 mono text-[11px]" style={{ color: 'var(--muted)' }}>
                    {formatGasUsedUsdc(log.gasUsedUsdc) || <span style={{ color: 'var(--subtle)' }}>{t('na')}</span>}
                  </td>
                  {/* Timestamp */}
                  <td className="px-5 py-3.5 text-[11px]">
                    <div className="mono" style={{ color: 'var(--ink-2)' }}>{formatAbsoluteTimestamp(log.timestampIso, locale)}</div>
                    <div style={{ color: 'var(--subtle)' }}>{toRelativeTimeClient(log.timestampMs, now)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t px-5 py-3" style={{ borderColor: 'var(--border)' }}>
          <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={!canGoPrevious}
            className="flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ borderColor: 'var(--border)', background: 'var(--surface-inner)', color: 'var(--ink-2)' }}>
            <ChevronLeft className="h-3.5 w-3.5" />
            Prev
          </button>
          <span className="mono text-[11px]" style={{ color: 'var(--subtle)' }}>
            {page} / {totalPages}
          </span>
          <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={!canGoNext}
            className="flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ borderColor: 'var(--border)', background: 'var(--surface-inner)', color: 'var(--ink-2)' }}>
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export const PortfolioTracker: React.FC = () => {
  const { t } = useLanguage();

  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <div className="glass-card p-6">
            <p className="text-sm" style={{ color: 'var(--muted)' }}>{t('loadingPortfolio')}</p>
          </div>
        </div>
      }
    >
      <PortfolioTrackerContent />
    </Suspense>
  );
};
