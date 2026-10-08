/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans:    ['var(--font-dm-sans)', '"DM Sans"', 'system-ui', 'sans-serif'],
        display: ['var(--font-space-grotesk)', '"Space Grotesk"', 'system-ui', 'sans-serif'],
        mono:    ['var(--font-jetbrains-mono)', '"JetBrains Mono"', 'Menlo', 'monospace'],
      },
      colors: {
        /* All colors reference CSS variables so they respond to data-theme switches.
           Tailwind needs the withOpacity helper pattern: use CSS-var-based values
           wrapped in rgb() with <alpha-value> so opacity modifiers (bg-X/50) work. */

        /* Canvas */
        background:  'var(--bg)',
        foreground:  'var(--ink)',

        /* Surfaces */
        surface:           'var(--surface)',
        'surface-strong':  'var(--surface-strong)',
        'surface-muted':   'var(--surface-muted)',
        'surface-inner':   'var(--surface-inner)',
        'surface-alt':     'var(--surface-alt)',

        /* Cards */
        card:        'var(--card)',
        cardBorder:  'var(--cardBorder)',

        /* Typography */
        ink:    'var(--ink)',
        'ink-2':'var(--ink-2)',
        muted:  'var(--muted)',
        subtle: 'var(--subtle)',

        /* Borders */
        border:          'var(--border)',
        'border-strong': 'var(--border-strong)',
        'border-focus':  'var(--border-focus)',

        /* Brand / Accent */
        primary: {
          DEFAULT: 'var(--accent)',
          hover:   'var(--accent-hover)',
          fg:      'var(--accent-fg)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hover:   'var(--accent-hover)',
          fg:      'var(--accent-fg)',
        },

        /* Semantic */
        success: {
          DEFAULT: 'var(--success)',
          bg:      'var(--success-bg)',
          fg:      'var(--success-fg)',
        },
        danger: {
          DEFAULT: 'var(--danger)',
          bg:      'var(--danger-bg)',
        },
        warning: {
          DEFAULT: 'var(--warning)',
          bg:      'var(--warning-bg)',
        },
      },
      borderRadius: {
        '4xl': '2rem',
      },
      boxShadow: {
        glow:           '0 0 24px rgba(var(--accent-rgb),0.15)',
        'glow-sm':      '0 0 12px rgba(var(--accent-rgb),0.10)',
        'glow-success': '0 0 20px rgba(111,207,151,0.18)',
        card:           '0 4px 24px rgba(0,0,0,0.35)',
        'card-lg':      '0 8px 48px rgba(0,0,0,0.50)',
      },
      backgroundImage: {
        'canvas-gradient': 'var(--bg-gradient)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
