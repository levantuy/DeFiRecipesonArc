import { RUNTIME_CONFIG } from '../../config/runtime';
import {
  GatewayProvider,
  GatewayTransferRequest,
  GatewayTransferResult,
  UnifiedBalanceProvider,
  UnifiedBalanceSnapshot,
  UnifiedBalanceSpendRequest,
  UnifiedBalanceSpendResult,
} from './types';

function normalizeTransferPath(path: string): string {
  if (!path.startsWith('/')) {
    return `/${path}`;
  }
  return path;
}

export class AppKitUnifiedBalanceProvider implements UnifiedBalanceProvider {
  private appKitInstance: unknown | null = null;

  private async getAppKit(): Promise<any> {
    if (this.appKitInstance) {
      return this.appKitInstance;
    }

    if (!RUNTIME_CONFIG.circleClientKey || !RUNTIME_CONFIG.circleClientUrl) {
      throw new Error(
        'CIRCLE_CLIENT_KEY and CIRCLE_CLIENT_URL are required when ENABLE_UNIFIED_BALANCE=true.'
      );
    }

    const moduleName = '@circle-fin/app-kit';
    const appKitModule = (await import(moduleName)) as { AppKit?: new (...args: unknown[]) => unknown };
    if (!appKitModule.AppKit) {
      throw new Error('Failed to load @circle-fin/app-kit. Ensure dependency is installed in keeper package.');
    }

    this.appKitInstance = new appKitModule.AppKit({
      clientKey: RUNTIME_CONFIG.circleClientKey,
      clientUrl: RUNTIME_CONFIG.circleClientUrl,
    });
    return this.appKitInstance as any;
  }

  async getBalances(depositorAddress: `0x${string}`): Promise<UnifiedBalanceSnapshot> {
    const appKit = await this.getAppKit();
    const api = appKit.unifiedBalance ?? appKit;

    const response =
      (await api.getBalances?.({ depositorAddress })) ??
      (await api.getBalances?.(depositorAddress)) ??
      (await api.getBalances?.());

    if (!response) {
      throw new Error('Unified balance provider did not return a balance response.');
    }

    const breakdown = Array.isArray(response.breakdown)
      ? response.breakdown.map((item: any) => ({
        chain: String(item.chain ?? ''),
        confirmedBalance: String(item.confirmedBalance ?? item.balance ?? '0'),
      }))
      : [];

    return {
      token: 'USDC',
      totalConfirmedBalance: String(response.totalConfirmedBalance ?? response.balance ?? '0'),
      breakdown,
    };
  }

  async spend(request: UnifiedBalanceSpendRequest): Promise<UnifiedBalanceSpendResult> {
    const appKit = await this.getAppKit();
    const api = appKit.unifiedBalance ?? appKit;

    const response = await api.spend({
      amount: request.amount,
      from: {
        chain: request.sourceChain,
      },
      to: {
        chain: request.destinationChain,
        recipientAddress: request.recipientAddress,
      },
    });

    return {
      transferId: String(response.transferId ?? response.id ?? ''),
      txHash: String(response.txHash ?? '') as `0x${string}`,
      explorerUrl: String(response.explorerUrl ?? ''),
    };
  }
}

export class HttpGatewayProvider implements GatewayProvider {
  async transfer(request: GatewayTransferRequest): Promise<GatewayTransferResult> {
    const endpoint = `${RUNTIME_CONFIG.gatewayApiBaseUrl.replace(/\/$/, '')}${normalizeTransferPath(
      RUNTIME_CONFIG.gatewayTransferPath
    )}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: request.amount,
        sourceDomain: request.sourceDomain,
        destinationDomain: request.destinationDomain,
        destinationRecipient: request.destinationRecipient,
      }),
    });

    if (!response.ok) {
      const payload = await response.text();
      throw new Error(`Gateway transfer failed (${response.status}): ${payload}`);
    }

    const data = (await response.json()) as Record<string, unknown>;

    return {
      burnIntentId: String(data.burnIntentId ?? data.transferId ?? data.id ?? ''),
      destinationTxHash: data.destinationTxHash
        ? (String(data.destinationTxHash) as `0x${string}`)
        : undefined,
    };
  }
}