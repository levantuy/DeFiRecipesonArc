'use client';

/**
 * LogoBrand — DeFi Recipes on Arc
 *
 * Concept: 3 nodes connected by a smooth arc path.
 * • 3 nodes = recipe steps (source → transform → destination)
 * • Arc path = the Arc network carrying automated execution
 * • 2 pulse dots on the arc = keeper bot firing between steps
 * • Gradient: steel-blue → emerald matches the existing accent/success palette
 *
 * Variants:
 *   mark       — icon only (square, no text)
 *   wordmark   — text only ("DeFi Recipes")
 *   primary    — icon + full wordmark (default)
 *   compact    — icon + short wordmark ("Recipes")
 *
 * Sizes: sm | md | lg | xl
 */

import React from 'react';

type LogoVariant = 'mark' | 'wordmark' | 'primary' | 'compact';
type LogoSize   = 'sm' | 'md' | 'lg' | 'xl';

interface LogoBrandProps {
  variant?: LogoVariant;
  size?:    LogoSize;
  /** Force monochrome (inherits currentColor) */
  mono?:    boolean;
  className?: string;
}

const SIZES: Record<LogoSize, { icon: number; text: string; gap: string }> = {
  sm: { icon: 24, text: 'text-[13px]',   gap: 'gap-2'   },
  md: { icon: 32, text: 'text-[15px]',   gap: 'gap-2.5' },
  lg: { icon: 40, text: 'text-[18px]',   gap: 'gap-3'   },
  xl: { icon: 56, text: 'text-[24px]',   gap: 'gap-4'   },
};

/** Inline SVG mark — always crisp, no network request */
function LogoMark({ size, mono }: { size: number; mono: boolean }) {
  const id = React.useId().replace(/:/g, '');

  if (mono) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        fill="none"
        aria-hidden="true"
        style={{ flexShrink: 0 }}
      >
        <circle cx="7"    cy="28" r="3.5" fill="currentColor"/>
        <circle cx="20"   cy="10" r="3.5" fill="currentColor"/>
        <circle cx="33"   cy="28" r="3.5" fill="currentColor"/>
        <path
          d="M7 28 Q10 10 20 10 Q30 10 33 28"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />
        <circle cx="13.5" cy="16" r="1.5" fill="currentColor" opacity="0.6"/>
        <circle cx="26.5" cy="16" r="1.5" fill="currentColor" opacity="0.6"/>
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <defs>
        <linearGradient id={`gr-${id}`} x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#6FBFFF"/>
          <stop offset="100%" stopColor="#6FCF97"/>
        </linearGradient>
        <radialGradient id={`glow-${id}`} cx="50%" cy="65%" r="55%">
          <stop offset="0%"   stopColor="#6FBFFF" stopOpacity="0.14"/>
          <stop offset="100%" stopColor="#6FBFFF" stopOpacity="0"/>
        </radialGradient>
      </defs>
      {/* Ambient glow */}
      <ellipse cx="20" cy="23" rx="17" ry="13" fill={`url(#glow-${id})`}/>
      {/* Nodes */}
      <circle cx="7"    cy="28" r="3.5" fill={`url(#gr-${id})`}/>
      <circle cx="20"   cy="10" r="3.5" fill={`url(#gr-${id})`}/>
      <circle cx="33"   cy="28" r="3.5" fill={`url(#gr-${id})`}/>
      {/* Arc path */}
      <path
        d="M7 28 Q10 10 20 10 Q30 10 33 28"
        stroke={`url(#gr-${id})`}
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* Keeper pulse dots */}
      <circle cx="13.5" cy="16" r="1.5" fill={`url(#gr-${id})`} opacity="0.72"/>
      <circle cx="26.5" cy="16" r="1.5" fill={`url(#gr-${id})`} opacity="0.72"/>
    </svg>
  );
}

export const LogoBrand: React.FC<LogoBrandProps> = ({
  variant  = 'primary',
  size     = 'md',
  mono     = false,
  className = '',
}) => {
  const { icon, text, gap } = SIZES[size];

  const textColor = mono ? 'text-current' : 'text-[#f0f6ff]';

  if (variant === 'mark') {
    return (
      <span className={`inline-flex items-center ${className}`}>
        <LogoMark size={icon} mono={mono} />
      </span>
    );
  }

  if (variant === 'wordmark') {
    return (
      <span className={`inline-flex items-center ${className}`}>
        <span
          className={`font-display font-semibold tracking-tight leading-none ${text} ${textColor}`}
          style={{ fontFamily: 'var(--font-space-grotesk, "Space Grotesk", system-ui, sans-serif)' }}
        >
          DeFi{' '}
          <span
            style={{
              background: mono ? undefined : 'linear-gradient(135deg, #6FBFFF 0%, #6FCF97 100%)',
              WebkitBackgroundClip: mono ? undefined : 'text',
              WebkitTextFillColor: mono ? undefined : 'transparent',
              backgroundClip: mono ? undefined : 'text',
              color: mono ? 'currentColor' : undefined,
            }}
          >
            Recipes
          </span>
        </span>
      </span>
    );
  }

  const label = variant === 'compact' ? 'Recipes' : undefined;

  return (
    <span className={`inline-flex items-center ${gap} ${className}`}>
      <LogoMark size={icon} mono={mono} />
      <span
        className={`font-semibold tracking-tight leading-none ${text} ${textColor}`}
        style={{ fontFamily: 'var(--font-space-grotesk, "Space Grotesk", system-ui, sans-serif)' }}
      >
        {label ?? (
          <>
            DeFi{' '}
            <span
              style={{
                background: mono ? undefined : 'linear-gradient(135deg, #6FBFFF 0%, #6FCF97 100%)',
                WebkitBackgroundClip: mono ? undefined : 'text',
                WebkitTextFillColor: mono ? undefined : 'transparent',
                backgroundClip: mono ? undefined : 'text',
                color: mono ? 'currentColor' : undefined,
              }}
            >
              Recipes
            </span>
          </>
        )}
      </span>
    </span>
  );
};

export default LogoBrand;
