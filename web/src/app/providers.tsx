'use client';

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import { wagmiConfig } from '@/lib/wagmi';
import { LanguageProvider, type Lang } from '@/lib/i18n/LanguageProvider';

const queryClient = new QueryClient();

export function Providers({ children, initialLang = 'en' }: { children: React.ReactNode; initialLang?: Lang }) {
  return (
    <LanguageProvider initialLang={initialLang}>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider theme={darkTheme({ accentColor: '#3B82F6' })}>
            {children}
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </LanguageProvider>
  );
}
