export interface AlertThresholds {
  cronCycleP95Ms: number;
  rpcCallsPerCycleP95: number;
  simulationRateLimitFailureRate: number;
  enqueueToSubmittedP95Ms: number;
  enqueueToConfirmedP95Ms: number;
}

function parseThreshold(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid threshold ${key}. Must be a positive number.`);
  }
  return value;
}

export function getAlertThresholds(): AlertThresholds {
  return {
    cronCycleP95Ms: parseThreshold('ALERT_CRON_CYCLE_P95_MS', 1500),
    rpcCallsPerCycleP95: parseThreshold('ALERT_RPC_CALLS_PER_CYCLE_P95', 150),
    simulationRateLimitFailureRate: parseThreshold('ALERT_SIM_RATE_LIMIT_FAILURE_RATE', 0.08),
    enqueueToSubmittedP95Ms: parseThreshold('ALERT_ENQUEUE_TO_SUBMITTED_P95_MS', 2500),
    enqueueToConfirmedP95Ms: parseThreshold('ALERT_ENQUEUE_TO_CONFIRMED_P95_MS', 5000),
  };
}
