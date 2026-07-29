import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { arcTestnet } from 'viem/chains';
import { fallback, http } from 'wagmi';

const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';
const defaultArcRpcUrls = ['https://rpc.testnet.arc.io', 'https://rpc.testnet.arc.network'];

function toRpcList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

const rpcCandidates = Array.from(
  new Set([
    ...toRpcList(process.env.NEXT_PUBLIC_ARC_RPC_URL),
    ...toRpcList(process.env.NEXT_PUBLIC_ARC_RPC_FALLBACK_URLS),
    ...defaultArcRpcUrls,
    ...(arcTestnet.rpcUrls.default.http ?? []),
  ])
);

const configuredArcTestnet = {
  ...arcTestnet,
  rpcUrls: {
    default: { http: rpcCandidates },
    public: { http: rpcCandidates },
  },
};

const arcTransport =
  rpcCandidates.length > 1
    ? fallback(rpcCandidates.map((url) => http(url, { timeout: 10_000 })))
    : http(rpcCandidates[0], { timeout: 10_000 });

export const wagmiConfig = getDefaultConfig({
  appName: 'DeFi Recipes on Arc',
  projectId: walletConnectProjectId,
  chains: [configuredArcTestnet],
  transports: {
    [configuredArcTestnet.id]: arcTransport,
  },
  ssr: true,
});
