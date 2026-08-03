import { getAlertThresholds } from './alertThresholds';

interface KeeperMetricsEnvelope {
  status: string;
  metrics: {
    histograms: {
      cronCycleDurationMs: { p95: number };
      rpcCallsPerCycle: { p95: number };
      queueLeadTimeToSubmittedMs: { p95: number };
      queueLeadTimeToConfirmedMs: { p95: number };
    };
    rates: {
      simulationRateLimitFailureRate: number;
    };
  };
}

function getKeeperMetricsUrl(): string {
  return process.env.KEEPER_METRICS_URL || 'http://localhost:8787/metrics';
}

function toRounded(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function monitorKeeperAlerts(): Promise<void> {
  const thresholds = getAlertThresholds();
  const metricsUrl = getKeeperMetricsUrl();

  const response = await fetch(metricsUrl, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Cannot query keeper metrics (${response.status}) from ${metricsUrl}`);
  }

  const payload = (await response.json()) as KeeperMetricsEnvelope;
  if (payload.status !== 'ok' || !payload.metrics) {
    throw new Error(`Keeper metrics response is malformed from ${metricsUrl}`);
  }

  const checks = [
    {
      label: 'cronCycleDuration.p95Ms',
      value: payload.metrics.histograms.cronCycleDurationMs.p95,
      threshold: thresholds.cronCycleP95Ms,
    },
    {
      label: 'rpcCallsPerCycle.p95',
      value: payload.metrics.histograms.rpcCallsPerCycle.p95,
      threshold: thresholds.rpcCallsPerCycleP95,
    },
    {
      label: 'simulationRateLimitFailureRate',
      value: payload.metrics.rates.simulationRateLimitFailureRate,
      threshold: thresholds.simulationRateLimitFailureRate,
    },
    {
      label: 'enqueueToSubmitted.p95Ms',
      value: payload.metrics.histograms.queueLeadTimeToSubmittedMs.p95,
      threshold: thresholds.enqueueToSubmittedP95Ms,
    },
    {
      label: 'enqueueToConfirmed.p95Ms',
      value: payload.metrics.histograms.queueLeadTimeToConfirmedMs.p95,
      threshold: thresholds.enqueueToConfirmedP95Ms,
    },
  ];

  const violations = checks.filter((check) => check.value > check.threshold);

  for (const check of checks) {
    const indicator = check.value > check.threshold ? 'ALERT' : 'OK';
    console.log(
      `[${indicator}] ${check.label}: value=${toRounded(check.value)} threshold=${toRounded(check.threshold)}`
    );
  }

  if (violations.length > 0) {
    const summary = violations
      .map((check) => `${check.label}=${toRounded(check.value)}>${toRounded(check.threshold)}`)
      .join(', ');
    throw new Error(`Keeper performance alerts triggered: ${summary}`);
  }
}

if (require.main === module) {
  monitorKeeperAlerts()
    .then(() => {
      console.log('Keeper performance alerts: all checks within threshold.');
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exit(1);
    });
}
