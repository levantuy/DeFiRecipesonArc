import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { arcTestnet } from 'viem/chains';

export const wagmiConfig = getDefaultConfig({
  appName: 'DeFi Recipes on Arc',
  projectId: 'DEFI_RECIPES_ARC_PROJECT_ID',
  chains: [arcTestnet],
  ssr: true,
});
