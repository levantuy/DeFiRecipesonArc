import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'DeFi Recipes on Arc - Automated Non-Custodial Yield Workflows',
  description: 'Trusted, secure, and automated DeFi workflow recipes built specifically for Arc Network with native USDC gas.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = cookies().get('NEXT_LOCALE')?.value === 'vi' ? 'vi' : 'en';

  return (
    <html lang={locale} className="dark">
      <body className="antialiased bg-background text-foreground min-h-screen">
        <Providers initialLang={locale}>{children}</Providers>
      </body>
    </html>
  );
}
