import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const request = {
  recipientAddress: '0x1111111111111111111111111111111111111111' as `0x${string}`,
  amountInBaseUnits: 50_000_000n,
  maxSlippageBps: 100,
  targetAssetSymbol: 'cirBTC',
};

describe('dcaSwapRouteClient', () => {
  it('resolves route via stablecoin swap service response transaction instruction', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          transaction: {
            executionParams: {
              instructions: [
                {
                  target: '0x2222222222222222222222222222222222222222',
                  data: '0x12345678',
                  minTokenOut: '49000000',
                },
              ],
            },
          },
          stopLimit: '48900000',
        }),
    });

    vi.stubGlobal('fetch', fetchMock);

    const { createDcaSwapRouteClientFromRuntime } = await import('../integrations/circle/dcaSwapRouteClient');
    const client = createDcaSwapRouteClientFromRuntime();

    const plan = await client.resolveRoute(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [endpoint, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(endpoint).toBe('https://api.circle.com/v1/stablecoinKits/swap');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual(
      expect.objectContaining({
        'Content-Type': 'application/json',
        Accept: 'application/json',
      })
    );

    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body.tokenInAddress).toBe('0x3600000000000000000000000000000000000000');
    expect(body.tokenOutAddress).toBe('0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF');
    expect(body.amount).toBe('50000000');

    expect(plan).toEqual({
      targetProtocolAddress: '0x2222222222222222222222222222222222222222',
      callData: '0x12345678',
      minSwapAssetOutBaseUnits: 49000000n,
    });
  });

  it('resolves route from legacy to/data response shape', async () => {
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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(plan).toEqual({
      targetProtocolAddress: '0x3333333333333333333333333333333333333333',
      callData: '0x87654321',
      minSwapAssetOutBaseUnits: 48000000n,
    });
  });

  it('extracts spenderAddress from allowanceTarget when provided by service response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          transaction: {
            executionParams: {
              instructions: [
                {
                  target: '0x4444444444444444444444444444444444444444',
                  data: '0x12345678',
                },
              ],
            },
          },
          quote: {
            allowanceTarget: '0x5555555555555555555555555555555555555555',
          },
          minAmountOut: '47000000',
        }),
    });

    vi.stubGlobal('fetch', fetchMock);

    const { createDcaSwapRouteClientFromRuntime } = await import('../integrations/circle/dcaSwapRouteClient');
    const client = createDcaSwapRouteClientFromRuntime();

    const plan = await client.resolveRoute(request);

    expect(plan).toEqual({
      targetProtocolAddress: '0x4444444444444444444444444444444444444444',
      callData: '0x12345678',
      minSwapAssetOutBaseUnits: 47000000n,
      spenderAddress: '0x5555555555555555555555555555555555555555',
    });
  });

  it('throws a clear error when stablecoin service request fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => '{"message":"Invalid params"}',
    });

    vi.stubGlobal('fetch', fetchMock);

    const { createDcaSwapRouteClientFromRuntime } = await import('../integrations/circle/dcaSwapRouteClient');
    const client = createDcaSwapRouteClientFromRuntime();

    await expect(client.resolveRoute(request)).rejects.toThrow('Arc App Kit swap service request failed: {"message":"Invalid params"}');
  });
});
