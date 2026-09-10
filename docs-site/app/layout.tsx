import './global.css';
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { ReactNode } from 'react';

export const metadata = {
  title: {
    default: 'DeFi Recipes on Arc — Documentation',
    template: '%s | DeFi Recipes on Arc',
  },
  description:
    'Tài liệu kỹ thuật của dự án DeFi Recipes on Arc: kiến trúc smart contract, quy trình phát triển và vận hành.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
