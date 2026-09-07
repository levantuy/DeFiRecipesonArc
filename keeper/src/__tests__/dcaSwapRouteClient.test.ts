import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { arcTestnet } from 'viem/chains';

const { createConfigMock, getQuoteMock } = vi.hoisted(() => ({
  createConfigMock: vi.fn(),
  getQuoteMock: vi.fn(),
}));

vi.mock('@lifi/sdk', () => ({
  createConfig: createConfigMock,
  getQuote: getQuoteMock,
}));

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.DCA_ROUTE_PROVIDER;
  delete process.env.DCA_ROUTE_ALLOW_APP_KIT_FALLBACK;
  delete process.env.LIFI_INTEGRATOR;
  delete process.env.LIFI_API_KEY;
  delete process.env.LIFI_API_BASE_URL;
  delete process.env.ARC_APP_KIT_API_BASE_URL;
  delete process.env.ARC_APP_KIT_API_KEY;
  delete process.env.ARC_APP_KIT_SWAP_BASE_URL;
  delete process.env.ARC_APP_KIT_KEY;
});

beforeEach(() => {
  createConfigMock.mockReset();
  getQuoteMock.mockReset();
});

const request = {
  recipientAddress: '0x1111111111111111111111111111111111111111' as `0x${string}`,
  amountInBaseUnits: 50_000_000n,
  maxSlippageBps: 100,
  targetAssetSymbol: 'cirBTC',
};

describe('dcaSwapRouteClient', () => {
  it('resolves Arc quote via LI.FI and maps target/callData/minOut/spender', async () => {
    process.env.LIFI_API_KEY = 'test-lifi-api-key';

    getQuoteMock.mockResolvedValue({
      transactionRequest: {
        to: '0x2222222222222222222222222222222222222222',
        data: '0x12345678',
      },
      estimate: {
        toAmountMin: '49000000',
        approvalAddress: '0x5555555555555555555555555555555555555555',
      },
    });

    const { createDcaSwapRouteClientFromRuntime } = await import('../integrations/circle/dcaSwapRouteClient');
    const client = createDcaSwapRouteClientFromRuntime();

    const plan = await client.resolveRoute(request);

    expect(createConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        integrator: 'defirecipes',
        apiKey: 'test-lifi-api-key',
      })
    );
    expect(getQuoteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fromChain: arcTestnet.id,
        toChain: arcTestnet.id,
        fromToken: '0x3600000000000000000000000000000000000000',
        toToken: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF',
        fromAmount: '50000000',
        slippage: 0.01,
      })
    );

    expect(plan).toEqual({
      targetProtocolAddress: '0x2222222222222222222222222222222222222222',
      callData: '0x12345678',
      minSwapAssetOutBaseUnits: 49000000n,
      spenderAddress: '0x5555555555555555555555555555555555555555',
    });
  });

  it('throws clear error when LI.FI does not support Arc', async () => {
    getQuoteMock.mockRejectedValue(new Error(`chain ${arcTestnet.id} not supported`));

    const { createDcaSwapRouteClientFromRuntime } = await import('../integrations/circle/dcaSwapRouteClient');
    const client = createDcaSwapRouteClientFromRuntime();

    await expect(client.resolveRoute(request)).rejects.toThrow('LI.FI does not support Arc Testnet');
  });

  it('throws no-route error when LI.FI cannot find Arc route', async () => {
    getQuoteMock.mockRejectedValue(new Error('No route found for request'));

    const { createDcaSwapRouteClientFromRuntime } = await import('../integrations/circle/dcaSwapRouteClient');
    const client = createDcaSwapRouteClientFromRuntime();

    await expect(client.resolveRoute(request)).rejects.toThrow('LI.FI has no route available on Arc Testnet');
  });

  it('retries without API key when LI.FI returns invalid API key', async () => {
    process.env.LIFI_API_KEY = 'invalid-key';
    getQuoteMock
      .mockRejectedValueOnce(
        new Error('[HTTPError] [ServerError] Request failed with status code 401 Unauthorized. Invalid API key')
      )
      .mockResolvedValueOnce({
        transactionRequest: {
          to: '0x2222222222222222222222222222222222222222',
          data: '0x12345678',
        },
        estimate: {
          toAmountMin: '47000000',
        },
      });

    const { createDcaSwapRouteClientFromRuntime } = await import('../integrations/circle/dcaSwapRouteClient');
    const client = createDcaSwapRouteClientFromRuntime();
    const plan = await client.resolveRoute(request);

    expect(createConfigMock).toHaveBeenCalledTimes(2);
    expect(createConfigMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        integrator: 'defirecipes',
        apiKey: 'invalid-key',
      })
    );
    expect(createConfigMock.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        integrator: 'defirecipes',
      })
    );
    expect(createConfigMock.mock.calls[1]?.[0]).not.toHaveProperty('apiKey');

    expect(plan).toEqual({
      targetProtocolAddress: '0x2222222222222222222222222222222222222222',
      callData: '0x12345678',
      minSwapAssetOutBaseUnits: 47000000n,
    });
  });

  it('throws clear configuration error for invalid LIFI_INTEGRATOR format', async () => {
    process.env.LIFI_INTEGRATOR = 'invalid integrator with spaces';

    const { createDcaSwapRouteClientFromRuntime } = await import('../integrations/circle/dcaSwapRouteClient');
    const client = createDcaSwapRouteClientFromRuntime();

    await expect(client.resolveRoute(request)).rejects.toThrow('Invalid LIFI_INTEGRATOR');
  });

  it('falls back to App Kit on Arc when enabled and LI.FI fails', async () => {
    process.env.DCA_ROUTE_ALLOW_APP_KIT_FALLBACK = 'true';
    getQuoteMock.mockRejectedValue(new Error('upstream timeout'));

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          transaction: {
            executionParams: {
              instructions: [
                {
                  target: '0x6666666666666666666666666666666666666666',
                  data: '0x7ebc46f00000000000000000000000000000000000000000000000000000000000000002',
                  minTokenOut: '45550000',
                },
              ],
            },
          },
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { createDcaSwapRouteClientFromRuntime } = await import('../integrations/circle/dcaSwapRouteClient');
    const client = createDcaSwapRouteClientFromRuntime();
    const plan = await client.resolveRoute(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(plan).toEqual({
      targetProtocolAddress: '0x6666666666666666666666666666666666666666',
      callData: '0x7ebc46f00000000000000000000000000000000000000000000000000000000000000002',
      minSwapAssetOutBaseUnits: 45550000n,
    });
  });

  it('keeps explicit App Kit provider mode when configured', async () => {
    process.env.DCA_ROUTE_PROVIDER = 'ARC_APP_KIT_SWAP';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          to: '0x3333333333333333333333333333333333333333',
          data: '0x87654321',
          minAmountOut: '48000000',
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { createDcaSwapRouteClientFromRuntime } = await import('../integrations/circle/dcaSwapRouteClient');
    const client = createDcaSwapRouteClientFromRuntime();

    const plan = await client.resolveRoute(request);

    expect(getQuoteMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(plan).toEqual({
      targetProtocolAddress: '0x3333333333333333333333333333333333333333',
      callData: '0x87654321',
      minSwapAssetOutBaseUnits: 48000000n,
    });
  });

  it('accepts APP_KIT_SWAP alias and uses ARC_APP_KIT_API_KEY for auth', async () => {
    process.env.DCA_ROUTE_PROVIDER = 'APP_KIT_SWAP';
    process.env.ARC_APP_KIT_API_KEY = 'arc-app-kit-api-key';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          to: '0x4444444444444444444444444444444444444444',
          data: '0xabcdef12',
          minAmountOut: '47000000',
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { createDcaSwapRouteClientFromRuntime } = await import('../integrations/circle/dcaSwapRouteClient');
    const client = createDcaSwapRouteClientFromRuntime();

    const plan = await client.resolveRoute(request);

    expect(getQuoteMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer arc-app-kit-api-key',
        }),
      })
    );
    expect(plan).toEqual({
      targetProtocolAddress: '0x4444444444444444444444444444444444444444',
      callData: '0xabcdef12',
      minSwapAssetOutBaseUnits: 47000000n,
    });
  });

});
