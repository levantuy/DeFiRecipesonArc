'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { Wallet, ArrowUpRight, History, CheckCircle, Clock, AlertTriangle } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { formatUnits } from 'viem';
import { useAccount, useBalance } from 'wagmi';

import { CONTRACT_ADDRESSES } from '../config/contracts';

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

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

function isAddress(value: string): value is `0x${string}` {
  return ADDRESS_REGEX.test(value);
}

const RECIPE_NAME_BY_TYPE: Record<string, string> = {
  AUTO_COMPOUNDER: 'USDC Yield Auto-Compounder',
  RECURRING_DCA: 'USDC -> cirBTC Recurring DCA',
  SMART_YIELD_REBALANCER: 'USDC Smart Yield Rebalancer',
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

function formatAbsoluteTimestamp(isoTimestamp: string): string {
  const parsed = Date.parse(isoTimestamp);
  if (!Number.isFinite(parsed)) {
    return 'N/A';
  }
  return new Date(parsed).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function shortenAddress(address: string): string {
  if (!isAddress(address)) {
    return address;
  }
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function splitUsdDisplay(value: number, fractionDigits: number): { whole: string; fraction: string } {
  const normalized = Number.isFinite(value) ? Math.max(0, value) : 0;
  const [whole = '0', fraction = '00'] = normalized
    .toLocaleString('en-US', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    })
    .split('.');

  return { whole, fraction };
}

function parseUsdcAmount(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const PortfolioTrackerContent: React.FC = () => {
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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [sortMode, setSortMode] = useState<SortMode>('NEWEST');
  const [userAddressInput, setUserAddressInput] = useState('');
  const [userAddressFilter, setUserAddressFilter] = useState('');

  useEffect(() => {
    const queryAddress = (safeSearchParams.get('userAddress') || '').trim().toLowerCase();
    const queryStatus = (safeSearchParams.get('status') || 'ALL').toUpperCase() as StatusFilter;
    const querySort = (safeSearchParams.get('sort') || 'NEWEST').toUpperCase() as SortMode;

    const nextStatus = VALID_STATUS_FILTERS.includes(queryStatus) ? queryStatus : 'ALL';
    const nextSort = VALID_SORT_MODES.includes(querySort) ? querySort : 'NEWEST';
    const nextUserFilter = queryAddress && isAddress(queryAddress) ? queryAddress : '';

    setStatusFilter(nextStatus);
    setSortMode(nextSort);
    setUserAddressInput(nextUserFilter);
    setUserAddressFilter(nextUserFilter);
  }, [safeSearchParams]);

  useEffect(() => {
    const nextParams = new URLSearchParams(safeSearchParams.toString());

    if (userAddressFilter) {
      nextParams.set('userAddress', userAddressFilter);
    } else {
      nextParams.delete('userAddress');
    }

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
  }, [router, safePathname, safeSearchParams, sortMode, statusFilter, userAddressFilter]);

  useEffect(() => {
    if (!address || userAddressInput || userAddressFilter) {
      return;
    }

    const lower = address.toLowerCase();
    setUserAddressInput(lower);
    setUserAddressFilter(lower);
  }, [address, userAddressFilter, userAddressInput]);

  const userAddressValidationError = useMemo(() => {
    const trimmed = userAddressInput.trim();
    if (!trimmed) {
      return null;
    }
    if (!isAddress(trimmed)) {
      return 'Address must be a valid 20-byte hex address (0x...).';
    }
    return null;
  }, [userAddressInput]);

  const isAllUsersMode = !userAddressFilter;

  useEffect(() => {
    let disposed = false;

    const fetchLogs = async () => {
      try {
        setIsLoadingLogs(true);
        const params = new URLSearchParams({ limit: '50' });
        if (userAddressFilter) {
          params.set('userAddress', userAddressFilter);
        }

        const response = await fetch(`/api/logs?${params.toString()}`, {
          method: 'GET',
          cache: 'no-store',
        });
        const payload = (await response.json().catch(() => null)) as
          | { success?: boolean; logs?: ApiAuditLogItem[]; error?: string }
          | null;

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

        if (!disposed) {
          setAuditLogs(mappedLogs);
          setLogsError(null);
        }
      } catch (error: unknown) {
        if (!disposed) {
          const message = error instanceof Error ? error.message : 'Unknown logs fetch error.';
          setLogsError(message);
          setAuditLogs([]);
        }
      } finally {
        if (!disposed) {
          setIsLoadingLogs(false);
        }
      }
    };

    void fetchLogs();
    const interval = setInterval(fetchLogs, 15_000);

    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, [userAddressFilter]);

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

  const activeRecipeCount = useMemo(() => {
    const activeStatuses: AuditLog['status'][] = ['CONFIRMED', 'SUBMITTED', 'SIMULATING'];
    return auditLogs.filter((log) => activeStatuses.includes(log.status)).length;
  }, [auditLogs]);

  const totalGasUsedUsdc = useMemo(() => {
    return auditLogs.reduce((sum, log) => sum + parseUsdcAmount(log.gasUsedUsdc), 0);
  }, [auditLogs]);

  const totalUsdcBalance = useMemo(() => {
    if (!usdcBalanceData) {
      return null;
    }
    return Number(formatUnits(usdcBalanceData.value, usdcBalanceData.decimals));
  }, [usdcBalanceData]);

  const totalUsdcBalanceDisplay = useMemo(() => {
    if (totalUsdcBalance === null) {
      return { whole: '--', fraction: '--' };
    }
    return splitUsdDisplay(totalUsdcBalance, 2);
  }, [totalUsdcBalance]);

  const totalGasUsedDisplay = useMemo(() => splitUsdDisplay(totalGasUsedUsdc, 2), [totalGasUsedUsdc]);

  const applyCurrentAddressFilter = () => {
    if (userAddressValidationError) {
      return;
    }
    setUserAddressFilter(userAddressInput.trim().toLowerCase());
  };

  const applyMyWalletFilter = () => {
    if (!address) {
      return;
    }

    const lower = address.toLowerCase();
    setUserAddressInput(lower);
    setUserAddressFilter(lower);
  };

  const clearAllUsersFilter = () => {
    setUserAddressInput('');
    setUserAddressFilter('');
  };

  return (
    <div className="space-y-6">
      {/* Deployed Smart Contracts Card Banner */}
      <div className="glass-card p-5 border-l-4 border-l-blue-500 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-blue-400">
            Arc Testnet Deployed Contracts (Chain ID 5042002)
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-950 text-emerald-400 border border-emerald-800">
            Live on Arc
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono">
          <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
            <div className="text-slate-400 text-[10px]">SessionKeyRegistry</div>
            <a
              href={`https://testnet.arcscan.app/address/${CONTRACT_ADDRESSES.sessionKeyRegistry}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline truncate block mt-0.5"
            >
              {CONTRACT_ADDRESSES.sessionKeyRegistry}
            </a>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
            <div className="text-slate-400 text-[10px]">RecipeGuardrail</div>
            <a
              href={`https://testnet.arcscan.app/address/${CONTRACT_ADDRESSES.recipeGuardrail}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline truncate block mt-0.5"
            >
              {CONTRACT_ADDRESSES.recipeGuardrail}
            </a>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
            <div className="text-slate-400 text-[10px]">SharedExecutorProxy</div>
            <a
              href={`https://testnet.arcscan.app/address/${CONTRACT_ADDRESSES.sharedExecutorProxy}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline truncate block mt-0.5"
            >
              {CONTRACT_ADDRESSES.sharedExecutorProxy}
            </a>
          </div>
        </div>
      </div>

      {/* Portfolio Header Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-card p-5">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono uppercase">
            <span>Total USDC Balance (6 Decimals)</span>
            <Wallet className="h-4 w-4 text-blue-400" />
          </div>
          <div className="text-3xl font-extrabold text-white font-mono mt-2">
            ${totalUsdcBalanceDisplay.whole}.<span className="text-slate-400 text-xl">{totalUsdcBalanceDisplay.fraction}</span>
          </div>
          <div className="text-xs text-emerald-400 mt-1 flex items-center space-x-1">
            <ArrowUpRight className="h-3.5 w-3.5" />
            <span>{isLoadingUsdcBalance ? 'Refreshing wallet balance...' : address ? 'Live wallet USDC balance on Arc Testnet' : 'Connect wallet to load live USDC balance'}</span>
          </div>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono uppercase">
            <span>Active Automated Recipes</span>
            <Clock className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="text-3xl font-extrabold text-white font-mono mt-2">
            {activeRecipeCount} <span className="text-xs font-sans font-normal text-slate-400">Recipes Running</span>
          </div>
          <div className="text-xs text-slate-400 mt-1">
            Scoped Keeper Authorization Active
          </div>
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono uppercase">
            <span>Cumulative Gas Used (USDC)</span>
            <CheckCircle className="h-4 w-4 text-purple-400" />
          </div>
          <div className="text-3xl font-extrabold text-white font-mono mt-2">
            ${totalGasUsedDisplay.whole}.<span className="text-slate-400 text-xl">{totalGasUsedDisplay.fraction}</span>
          </div>
          <div className="text-xs text-purple-300 mt-1">
            Summed from live execution logs (latest 50 entries)
          </div>
        </div>
      </div>

      {/* Execution Audit Log Table */}
      <div className="glass-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white flex items-center space-x-2">
            <History className="h-5 w-5 text-blue-400" />
            <span>Execution Audit Logs (Real-time Transparent History)</span>
          </h3>
          <span className="text-xs text-slate-400 font-mono">Audited SharedExecutorProxy</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
          <div className="lg:col-span-2 space-y-1.5">
            <label htmlFor="audit-user-address" className="block text-[11px] uppercase tracking-wide text-slate-400 font-mono">
              User Address Filter
            </label>
            <div className="flex gap-2">
              <input
                id="audit-user-address"
                type="text"
                value={userAddressInput}
                onChange={(event) => setUserAddressInput(event.target.value.trim())}
                placeholder="0x..."
                className="w-full rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs font-mono text-slate-200 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={applyCurrentAddressFilter}
                disabled={Boolean(userAddressValidationError)}
                className="rounded-lg border border-blue-700 bg-blue-950/70 px-3 py-2 text-xs font-semibold text-blue-300 hover:bg-blue-900/70 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={clearAllUsersFilter}
                className="rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800/70"
              >
                Clear
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={applyMyWalletFilter}
                disabled={!address}
                className="rounded-lg border border-emerald-700 bg-emerald-950/60 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-900/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                My Wallet
              </button>
              <button
                type="button"
                onClick={clearAllUsersFilter}
                className="rounded-lg border border-slate-700 bg-slate-900/70 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-slate-800/70"
              >
                All Users
              </button>
            </div>
            {userAddressValidationError ? (
              <p className="text-[11px] text-rose-300">{userAddressValidationError}</p>
            ) : (
              <p className="text-[11px] text-slate-500">
                {userAddressFilter
                  ? `Showing logs for ${shortenAddress(userAddressFilter)}.`
                  : 'Showing logs for all users.'}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="audit-status-filter" className="block text-[11px] uppercase tracking-wide text-slate-400 font-mono mb-1.5">
              Status Filter
            </label>
            <select
              id="audit-status-filter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs font-semibold text-slate-200 focus:border-blue-500 focus:outline-none"
            >
              <option value="ALL">ALL</option>
              <option value="CONFIRMED">CONFIRMED</option>
              <option value="SUBMITTED">SUBMITTED</option>
              <option value="SIMULATING">SIMULATING</option>
              <option value="REVERTED">REVERTED</option>
              <option value="SIMULATION_FAILED">SIMULATION_FAILED</option>
            </select>
          </div>

          <div>
            <label htmlFor="audit-sort-mode" className="block text-[11px] uppercase tracking-wide text-slate-400 font-mono mb-1.5">
              Sort Mode
            </label>
            <select
              id="audit-sort-mode"
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs font-semibold text-slate-200 focus:border-blue-500 focus:outline-none"
            >
              <option value="NEWEST">Timestamp: Newest first</option>
              <option value="OLDEST">Timestamp: Oldest first</option>
              <option value="STATUS">Status priority</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-900/60 text-xs uppercase font-mono text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-4 py-3">Recipe</th>
                {isAllUsersMode ? <th className="px-4 py-3">User Address</th> : null}
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Transaction Hash</th>
                <th className="px-4 py-3">Gas Fee (USDC)</th>
                <th className="px-4 py-3">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {isLoadingLogs ? (
                <tr>
                  <td colSpan={isAllUsersMode ? 6 : 5} className="px-4 py-4 text-xs text-slate-400">
                    Loading execution logs...
                  </td>
                </tr>
              ) : null}

              {!isLoadingLogs && logsError ? (
                <tr>
                  <td colSpan={isAllUsersMode ? 6 : 5} className="px-4 py-4 text-xs text-rose-300">
                    {logsError}
                  </td>
                </tr>
              ) : null}

              {!isLoadingLogs && !logsError && auditLogs.length === 0 ? (
                <tr>
                  <td colSpan={isAllUsersMode ? 6 : 5} className="px-4 py-4 text-xs text-slate-400">
                    No execution logs yet.
                  </td>
                </tr>
              ) : null}

              {!isLoadingLogs && !logsError && auditLogs.length > 0 && visibleLogs.length === 0 ? (
                <tr>
                  <td colSpan={isAllUsersMode ? 6 : 5} className="px-4 py-4 text-xs text-slate-400">
                    No logs match the selected filters.
                  </td>
                </tr>
              ) : null}

              {!isLoadingLogs && !logsError && visibleLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-white">{log.recipeName}</td>
                  {isAllUsersMode ? (
                    <td className="px-4 py-3 font-mono text-xs text-slate-300">{shortenAddress(log.userAddress)}</td>
                  ) : null}
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${toStatusClasses(log.status)}`}>
                      {log.status === 'CONFIRMED' ? (
                        <CheckCircle className="h-3 w-3" />
                      ) : (
                        <AlertTriangle className="h-3 w-3" />
                      )}
                      <span>{log.status}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-blue-400 text-xs">
                    {log.txHash ? (
                      <a
                        href={`https://testnet.arcscan.app/tx/${log.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        {`${log.txHash.slice(0, 10)}...${log.txHash.slice(-6)}`}
                      </a>
                    ) : (
                      <span className="text-slate-500">N/A</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{log.gasUsedUsdc || 'N/A'}</td>
                  <td className="px-4 py-3 text-xs">
                    <div className="text-slate-300 font-mono">{formatAbsoluteTimestamp(log.timestampIso)}</div>
                    <div className="text-slate-500">{log.timestampRelative}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export const PortfolioTracker: React.FC = () => {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <div className="glass-card p-6">
            <p className="text-sm text-slate-400">Loading portfolio tracker...</p>
          </div>
        </div>
      }
    >
      <PortfolioTrackerContent />
    </Suspense>
  );
};
