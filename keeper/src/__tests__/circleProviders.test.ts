import { afterEach, describe, expect, it, vi } from 'vitest';
import { RUNTIME_CONFIG } from '../config/runtime';
import { HttpGatewayProvider, AppKitUnifiedBalanceProvider } from '../integrations/circle/providers';

describe('Circle Provider Implementations', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    RUNTIME_CONFIG.circleClientKey = '';
    RUNTIME_CONFIG.circleClientUrl = '';
    vi.restoreAllMocks();
  });

  it('builds gateway transfer request and parses response', async () => {
    RUNTIME_CONFIG.gatewayApiBaseUrl = 'https://gateway-api-testnet.circle.com/';
    RUNTIME_CONFIG.gatewayTransferPath = '/v1/transfers';

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        burnIntentId: 'burn-1',
        destinationTxHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
    } as Response);

    const provider = new HttpGatewayProvider();
    const result = await provider.transfer({
      amount: '12.5',
      sourceDomain: 6,
      destinationDomain: 26,
      destinationRecipient: '0x1111111111111111111111111111111111111111',
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.burnIntentId).toBe('burn-1');
    expect(result.destinationTxHash).toBe(
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    );
  });

  it('fails unified balance provider when Circle client env is missing', async () => {
    const provider = new AppKitUnifiedBalanceProvider();

    await expect(
      provider.getBalances('0x1111111111111111111111111111111111111111')
    ).rejects.toThrow('CIRCLE_CLIENT_KEY and CIRCLE_CLIENT_URL are required');
  });
});
