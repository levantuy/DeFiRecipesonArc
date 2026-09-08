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

const ARC_SWAP_ADAPTER = '0xbbd70b01a1cabc96d5b7b129ae1aaabdf50dd40b';
const ARC_SWAP_ADAPTER_SELECTOR = '0xaa3e079c';

function appKitSwapResponse(overrides: { stopLimit?: string; minTokenOut?: string } = {}) {
  return {
    stopLimit: overrides.stopLimit ?? '45550000',
    transaction: {
      signature: '0xdeadbeef',
      executionParams: {
        execId: '0x01a07ee4317b764e924b2dde7fb87c6a',
        deadline: '1788835879',
        metadata: '0x',
        tokens: [
          {
            token: '0x3600000000000000000000000000000000000000',
            beneficiary: '0x1111111111111111111111111111111111111111',
          },
        ],
        instructions: [
          {
            target: '0xf992efcb5fa2ed7cb48310d9dd8cb4ce5fb7ddc9',
            data: '0x7ebc46f0',
            value: '0',
            tokenIn: '0x3600000000000000000000000000000000000000',
            amountToApprove: '10000',
            tokenOut: '0x0000000000000000000000000000000000000000',
            minTokenOut: '0',
          },
          {
            target: '0xff70f4a1d11995621854f3692acf286d8acd04b2',
            data: '0x4666fc80',
            value: '0x0',
            tokenIn: '0x3600000000000000000000000000000000000000',
            amountToApprove: '49990000',
            tokenOut: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF',
            minTokenOut: overrides.minTokenOut ?? '45550000',
          },
        ],
      },
    },
  };
}

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
      text: async () => JSON.stringify(appKitSwapResponse()),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { createDcaSwapRouteClientFromRuntime } = await import('../integrations/circle/dcaSwapRouteClient');
    const client = createDcaSwapRouteClientFromRuntime();
    const plan = await client.resolveRoute(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(plan.targetProtocolAddress).toBe(ARC_SWAP_ADAPTER);
    expect(plan.spenderAddress).toBe(ARC_SWAP_ADAPTER);
    expect(plan.callData.startsWith(ARC_SWAP_ADAPTER_SELECTOR)).toBe(true);
    expect(plan.minSwapAssetOutBaseUnits).toBe(45550000n);
  });

  it('keeps explicit App Kit provider mode when configured', async () => {
    process.env.DCA_ROUTE_PROVIDER = 'ARC_APP_KIT_SWAP';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(appKitSwapResponse({ stopLimit: '48000000' })),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { createDcaSwapRouteClientFromRuntime } = await import('../integrations/circle/dcaSwapRouteClient');
    const client = createDcaSwapRouteClientFromRuntime();

    const plan = await client.resolveRoute(request);

    expect(getQuoteMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(plan.targetProtocolAddress).toBe(ARC_SWAP_ADAPTER);
    expect(plan.callData.startsWith(ARC_SWAP_ADAPTER_SELECTOR)).toBe(true);
    expect(plan.minSwapAssetOutBaseUnits).toBe(48000000n);
  });

  it('accepts APP_KIT_SWAP alias and only authenticates with a Stablecoin Kit Key', async () => {
    process.env.DCA_ROUTE_PROVIDER = 'APP_KIT_SWAP';
    process.env.ARC_APP_KIT_API_KEY = 'KIT_KEY:key-id:key-secret';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(appKitSwapResponse({ stopLimit: '47000000' })),
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
          Authorization: 'Bearer KIT_KEY:key-id:key-secret',
        }),
      })
    );
    expect(plan.targetProtocolAddress).toBe(ARC_SWAP_ADAPTER);
    expect(plan.callData.startsWith(ARC_SWAP_ADAPTER_SELECTOR)).toBe(true);
    expect(plan.minSwapAssetOutBaseUnits).toBe(47000000n);
  });

});
