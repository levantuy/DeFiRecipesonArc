type CounterKey =
  | 'rpc.total'
  | 'rpc.rateLimited'
  | 'simulation.total'
  | 'simulation.rateLimitFailures'
  | 'queue.enqueued'
  | 'queue.submitted'
  | 'queue.confirmed'
  | 'queue.confirmationTimeouts';

interface HistogramSummary {
  count: number;
  p50: number;
  p95: number;
  max: number;
}

interface KeeperMetricsSnapshot {
  generatedAt: string;
  counters: Record<CounterKey, number>;
  histograms: {
    cronCycleDurationMs: HistogramSummary;
    rpcCallsPerCycle: HistogramSummary;
    queueLeadTimeToSubmittedMs: HistogramSummary;
    queueLeadTimeToConfirmedMs: HistogramSummary;
  };
  rates: {
    simulationRateLimitFailureRate: number;
  };
}

const MAX_SAMPLES = 5000;

const counters: Record<CounterKey, number> = {
  'rpc.total': 0,
  'rpc.rateLimited': 0,
  'simulation.total': 0,
  'simulation.rateLimitFailures': 0,
  'queue.enqueued': 0,
  'queue.submitted': 0,
  'queue.confirmed': 0,
  'queue.confirmationTimeouts': 0,
};

const cronCycleDurationSamples: number[] = [];
const rpcCallsPerCycleSamples: number[] = [];
const queueLeadTimeToSubmittedSamples: number[] = [];
const queueLeadTimeToConfirmedSamples: number[] = [];

function pushSample(samples: number[], value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return;
  }

  samples.push(value);
  if (samples.length > MAX_SAMPLES) {
    samples.shift();
  }
}

function percentile(samples: number[], p: number): number {
  if (samples.length === 0) {
    return 0;
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

function summarize(samples: number[]): HistogramSummary {
  if (samples.length === 0) {
    return { count: 0, p50: 0, p95: 0, max: 0 };
  }

  return {
    count: samples.length,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    max: Math.max(...samples),
  };
}

export function incrementCounter(key: CounterKey, value = 1) {
  counters[key] += value;
}

export function readCounter(key: CounterKey): number {
  return counters[key];
}

export function recordCronCycle(durationMs: number, rpcCalls: number) {
  pushSample(cronCycleDurationSamples, durationMs);
  pushSample(rpcCallsPerCycleSamples, rpcCalls);
}

export function recordQueueLeadTimeToSubmitted(leadTimeMs: number) {
  pushSample(queueLeadTimeToSubmittedSamples, leadTimeMs);
}

export function recordQueueLeadTimeToConfirmed(leadTimeMs: number) {
  pushSample(queueLeadTimeToConfirmedSamples, leadTimeMs);
}

export function getKeeperMetricsSnapshot(): KeeperMetricsSnapshot {
  const simulationTotal = counters['simulation.total'];
  const rateLimitFailures = counters['simulation.rateLimitFailures'];

  return {
    generatedAt: new Date().toISOString(),
    counters: { ...counters },
    histograms: {
      cronCycleDurationMs: summarize(cronCycleDurationSamples),
      rpcCallsPerCycle: summarize(rpcCallsPerCycleSamples),
      queueLeadTimeToSubmittedMs: summarize(queueLeadTimeToSubmittedSamples),
      queueLeadTimeToConfirmedMs: summarize(queueLeadTimeToConfirmedSamples),
    },
    rates: {
      simulationRateLimitFailureRate: simulationTotal > 0 ? rateLimitFailures / simulationTotal : 0,
    },
  };
}

export function resetKeeperMetrics() {
  for (const key of Object.keys(counters) as CounterKey[]) {
    counters[key] = 0;
  }

  cronCycleDurationSamples.length = 0;
  rpcCallsPerCycleSamples.length = 0;
  queueLeadTimeToSubmittedSamples.length = 0;
  queueLeadTimeToConfirmedSamples.length = 0;
}
