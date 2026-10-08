import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { DM_Sans, Space_Grotesk, JetBrains_Mono } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import { Providers } from './providers';
import { Analytics } from "@vercel/analytics/next"

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap',
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'DeFi Recipes on Arc — Automated Non-Custodial Yield Workflows',
  description: 'Automated DeFi workflow recipes on Arc Network. USDC auto-compounding, recurring DCA, and more — keyless, non-custodial, powered by session key delegation.',
  icons: {
    icon: [
      { url: '/favicon.svg',  type: 'image/svg+xml' },
      { url: '/favicon.ico',  sizes: '48x48' },
    ],
    apple: '/apple-touch-icon.svg',
  },
  themeColor: '#0d1b2f',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = (await cookies()).get('NEXT_LOCALE')?.value === 'vi' ? 'vi' : 'en';

  return (
    <html
      lang={locale}
      className={`${dmSans.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Anti-flash: read saved theme and apply BEFORE first paint.
            suppressHydrationWarning on <html> prevents React from overwriting
            the data-theme / class that this script sets on the server SSR default. */}
        <Script id="theme-init" strategy="beforeInteractive">{`
(function(){
  try {
    var t = localStorage.getItem('defi-recipes-theme');
    var r = document.documentElement;
    var isLight = t === 'light' || (!t && window.matchMedia('(prefers-color-scheme: light)').matches);
    if (isLight) {
      r.setAttribute('data-theme', 'light');
      r.classList.remove('dark');
    } else {
      r.setAttribute('data-theme', 'dark');
      r.classList.add('dark');
    }
  } catch(e) {}
})();
        `}</Script>
      </head>
      <body className="antialiased min-h-screen" style={{ background: 'var(--bg)', color: 'var(--ink)' }} suppressHydrationWarning>
        <Providers initialLang={locale}>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
