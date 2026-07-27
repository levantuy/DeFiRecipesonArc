import type { Metadata } from 'next';
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
  return (
    <html lang="en" className="dark">
      <body className="antialiased bg-background text-foreground min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
