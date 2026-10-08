'use client';

import Link from 'next/link';
import React, { useEffect, useRef, useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { ArrowUpRight, ChevronDown, Menu, Repeat2, X } from 'lucide-react';
import { useChainId } from 'wagmi';
import { LogoBrand } from '@/components/LogoBrand';
import { usePathname } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/LanguageProvider';

const ARC_CHAIN_ID = 5042002;

const APP_KIT_ITEMS = [
  {
    href:    '/swap',
    label:   'Swap',
    desc:    'USDC ↔ EURC via App Kit',
    icon:    <Repeat2 className="h-4 w-4" />,
    accent:  'text-blue-300',
  },
  {
    href:    '/bridge',
    label:   'Bridge',
    desc:    'Cross-chain via CCTP',
    icon:    <ArrowUpRight className="h-4 w-4" />,
    accent:  'text-emerald-300',
  },
  {
    href:    '/send',
    label:   'Send',
    desc:    'Same-chain USDC transfer',
    icon:    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/></svg>,
    accent:  'text-violet-300',
  },
  {
    href:    '/unified-balance',
    label:   'Unified Balance',
    desc:    'Cross-chain USDC pool',
    icon:    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/></svg>,
    accent:  'text-cyan-300',
  },
] as const;

const APP_KIT_PATHS = APP_KIT_ITEMS.map(i => i.href);

export const Navbar: React.FC = () => {
  const chainId    = useChainId();
  const pathname   = usePathname();
  const { lang, setLang, t } = useLanguage();
  const [mobileOpen,   setMobileOpen]   = useState(false);
  const [kitOpen,      setKitOpen]      = useState(false);
  const [kitMobOpen,   setKitMobOpen]   = useState(false);
  const kitRef = useRef<HTMLDivElement>(null);

  const isArc      = chainId === ARC_CHAIN_ID;
  const kitActive  = APP_KIT_PATHS.some(p => pathname?.startsWith(p));

  // Close dropdown on outside click / Escape
  useEffect(() => {
    if (!kitOpen) return;
    function onDown(e: MouseEvent) {
      if (!kitRef.current?.contains(e.target as Node)) setKitOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setKitOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [kitOpen]);

  // Close mobile menu on route change
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  return (
    <header className="sticky top-0 z-50" style={{ background: 'rgba(13,27,47,0.85)', backdropFilter: 'blur(20px) saturate(160%)', borderBottom: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between px-4 py-3 sm:px-6 max-w-7xl mx-auto">

        {/* Logo */}
        <Link href="/" className="flex items-center shrink-0 hover:opacity-90 transition-opacity">
          {/* Mobile: mark only */}
          <span className="sm:hidden">
            <LogoBrand variant="mark" size="sm" />
          </span>
          {/* sm+: full wordmark */}
          <span className="hidden sm:inline-flex">
            <LogoBrand variant="primary" size="sm" />
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center gap-1">
          {/* Recipes */}
          <Link
            href="/"
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              pathname === '/'
                ? 'bg-white/10 text-ink'
                : 'text-muted hover:text-ink hover:bg-white/5'
            }`}
          >
            Recipes
          </Link>

          {/* App Kit dropdown */}
          <div className="relative" ref={kitRef}>
            <button
              type="button"
              onClick={() => setKitOpen(o => !o)}
              aria-expanded={kitOpen}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                kitActive
                  ? 'bg-white/10 text-ink'
                  : 'text-muted hover:text-ink hover:bg-white/5'
              }`}
            >
              <span>App Kit</span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${kitOpen ? 'rotate-180' : ''}`} />
            </button>

            {kitOpen && (
              <div
                className="absolute left-0 top-[calc(100%+8px)] w-64 overflow-hidden rounded-2xl border shadow-card-lg"
                style={{ background: 'rgba(13,27,47,0.97)', borderColor: 'var(--border-strong)', backdropFilter: 'blur(40px)' }}
              >
                <div className="px-3 pt-3 pb-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted px-1">Circle App Kit</p>
                </div>
                {APP_KIT_ITEMS.map(item => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setKitOpen(false)}
                    className={`flex items-start gap-3 rounded-xl mx-1.5 mb-0.5 px-2.5 py-2.5 transition-colors hover:bg-white/7 ${
                      pathname?.startsWith(item.href) ? 'bg-white/8' : ''
                    }`}
                  >
                    <span className={`mt-0.5 shrink-0 ${item.accent}`}>{item.icon}</span>
                    <span>
                      <span className="block text-sm font-medium text-ink leading-none mb-0.5">{item.label}</span>
                      <span className="block text-xs text-muted">{item.desc}</span>
                    </span>
                    {pathname?.startsWith(item.href) && (
                      <span className="ml-auto mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    )}
                  </Link>
                ))}
                <div className="mx-3 mb-3 mt-2 rounded-xl border px-3 py-2" style={{ borderColor: 'var(--border)', background: 'var(--surface-inner)' }}>
                  <p className="text-[10px] text-subtle">Keyless · No backend · Browser wallet</p>
                </div>
              </div>
            )}
          </div>
        </nav>

        {/* Right side controls */}
        <div className="hidden lg:flex items-center gap-2.5">
          {/* Chain status */}
          <div className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-mono ${
            isArc
              ? 'border-success/30 bg-success/8 text-success'
              : 'border-warning/30 bg-warning/8 text-warning'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isArc ? 'bg-success animate-pulse' : 'bg-warning'}`} />
            <span>{isArc ? t('navArcTestnet') : t('navWrongNetwork')}</span>
          </div>

          {/* Language */}
          <select
            value={lang}
            onChange={e => setLang(e.target.value as 'en' | 'vi')}
            aria-label={t('navLanguage')}
            className="nav-lang-select rounded-lg border px-2.5 py-1.5 text-xs font-semibold cursor-pointer"
            style={{
              backgroundColor: 'var(--surface-muted)',
              color: 'var(--ink)',
              borderColor: 'var(--border)',
              WebkitTextFillColor: 'var(--ink)',
              colorScheme: 'dark',
            }}
          >
            <option value="en" style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}>EN</option>
            <option value="vi" style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}>VI</option>
          </select>

          <ConnectButton showBalance={false} />
        </div>

        {/* Mobile: wallet + hamburger */}
        <div className="flex lg:hidden items-center gap-2">
          <ConnectButton showBalance={false} accountStatus="avatar" chainStatus="none" />
          <button
            type="button"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMobileOpen(o => !o)}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-muted hover:text-ink transition-colors"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Mobile panel */}
      {mobileOpen && (
        <div className="lg:hidden border-t px-4 py-3 space-y-0.5" style={{ background: 'rgba(13,27,47,0.97)', borderColor: 'var(--border)' }}>
          <Link
            href="/"
            className={`block rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
              pathname === '/' ? 'bg-white/10 text-ink' : 'text-muted hover:text-ink hover:bg-white/5'
            }`}
          >
            Recipes
          </Link>

          {/* App Kit collapsible */}
          <div>
            <button
              type="button"
              onClick={() => setKitMobOpen(o => !o)}
              className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
                kitActive ? 'bg-white/10 text-ink' : 'text-muted hover:text-ink hover:bg-white/5'
              }`}
            >
              <span>App Kit</span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${kitMobOpen ? 'rotate-180' : ''}`} />
            </button>
            {kitMobOpen && (
              <div className="mt-0.5 ml-3 space-y-0.5 border-l pl-3" style={{ borderColor: 'var(--border)' }}>
                {APP_KIT_ITEMS.map(item => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                      pathname?.startsWith(item.href)
                        ? 'bg-white/8 text-ink'
                        : 'text-muted hover:text-ink hover:bg-white/5'
                    }`}
                  >
                    <span className={`shrink-0 ${item.accent}`}>{item.icon}</span>
                    <span>
                      <span className="block font-medium leading-tight">{item.label}</span>
                      <span className="block text-[11px] text-subtle">{item.desc}</span>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Footer row */}
          <div className="flex items-center justify-between pt-2.5 mt-1.5 border-t" style={{ borderColor: 'var(--border)' }}>
            <div className={`flex items-center gap-1.5 text-xs font-mono ${isArc ? 'text-success' : 'text-warning'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${isArc ? 'bg-success animate-pulse' : 'bg-warning'}`} />
              {isArc ? t('navArcTestnet') : t('navWrongNetwork')}
            </div>
            <select
              value={lang}
              onChange={e => setLang(e.target.value as 'en' | 'vi')}
              aria-label={t('navLanguage')}
              className="nav-lang-select rounded-lg border px-2 py-1 text-xs font-semibold"
              style={{
                backgroundColor: 'var(--surface-muted)',
                color: 'var(--ink)',
                borderColor: 'var(--border)',
                WebkitTextFillColor: 'var(--ink)',
                colorScheme: 'dark',
              }}
            >
              <option value="en" style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}>EN</option>
              <option value="vi" style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}>VI</option>
            </select>
          </div>
        </div>
      )}
    </header>
  );
};
