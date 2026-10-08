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
    <html lang={locale} className={`dark ${dmSans.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}>
      <body className="antialiased bg-background text-foreground min-h-screen">
        <Providers initialLang={locale}>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
