'use client';

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider, darkTheme, lightTheme } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import { wagmiConfig } from '@/lib/wagmi';
import { LanguageProvider, type Lang } from '@/lib/i18n/LanguageProvider';
import { ThemeProvider, useTheme } from '@/lib/theme/ThemeProvider';

const queryClient = new QueryClient();

/** Inner wrapper that reads theme context to configure RainbowKit */
function RainbowKitThemeWrapper({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const rkTheme = theme === 'light'
    ? lightTheme({ accentColor: '#2c5282', accentColorForeground: 'white' })
    : darkTheme({ accentColor: '#acc6e9', accentColorForeground: '#0d1b2f' });

  return (
    <RainbowKitProvider theme={rkTheme}>
      {children}
    </RainbowKitProvider>
  );
}

export function Providers({ children, initialLang = 'en' }: { children: React.ReactNode; initialLang?: Lang }) {
  return (
    <ThemeProvider>
      <LanguageProvider initialLang={initialLang}>
        <WagmiProvider config={wagmiConfig}>
          <QueryClientProvider client={queryClient}>
            <RainbowKitThemeWrapper>
              {children}
            </RainbowKitThemeWrapper>
          </QueryClientProvider>
        </WagmiProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
