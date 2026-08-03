import { afterEach, describe, expect, it, vi } from 'vitest';
import { monitorKeeperAlerts } from '../observability/monitorAlerts';

describe('Keeper Alert Monitor', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    delete process.env.KEEPER_METRICS_URL;
  });

  it('passes when metrics are under thresholds', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        metrics: {
          histograms: {
            cronCycleDurationMs: { p95: 900 },
            rpcCallsPerCycle: { p95: 90 },
            queueLeadTimeToSubmittedMs: { p95: 1000 },
            queueLeadTimeToConfirmedMs: { p95: 2000 },
          },
          rates: {
            simulationRateLimitFailureRate: 0.01,
          },
        },
      }),
    } as Response);

    await expect(monitorKeeperAlerts()).resolves.toBeUndefined();
  });

  it('throws when thresholds are violated', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        metrics: {
          histograms: {
            cronCycleDurationMs: { p95: 5000 },
            rpcCallsPerCycle: { p95: 400 },
            queueLeadTimeToSubmittedMs: { p95: 7000 },
            queueLeadTimeToConfirmedMs: { p95: 9000 },
          },
          rates: {
            simulationRateLimitFailureRate: 0.3,
          },
        },
      }),
    } as Response);

    await expect(monitorKeeperAlerts()).rejects.toThrow('Keeper performance alerts triggered');
  });
});
