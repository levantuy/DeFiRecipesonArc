import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { DM_Sans, Space_Grotesk, JetBrains_Mono } from 'next/font/google';
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
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: '48x48' },
    ],
    apple: '/apple-touch-icon.svg',
  },
};

// Inline script string — runs synchronously before any CSS paint.
// Next.js 15 App Router: <Script strategy="beforeInteractive"> does NOT
// guarantee execution before hydration. Only a raw inline <script> in <head>
// is truly synchronous. dangerouslySetInnerHTML is the correct approach here.
const themeScript = `(function(){try{
  var s=localStorage.getItem('defi-recipes-theme');
  var r=document.documentElement;
  var light=s==='light'||(s===null&&window.matchMedia('(prefers-color-scheme:light)').matches);
  if(light){r.setAttribute('data-theme','light');r.classList.remove('dark');}
  else{r.setAttribute('data-theme','dark');r.classList.add('dark');}
}catch(e){}})();`;

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
        {/* Runs synchronously before CSS paint — sets data-theme from localStorage */}
        {/* eslint-disable-next-line @next/next/no-before-interactive-script-outside-document */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        className="antialiased min-h-screen"
        suppressHydrationWarning
      >
        <Providers initialLang={locale}>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
