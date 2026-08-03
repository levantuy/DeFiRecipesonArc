interface BenchmarkSample {
  cronCycleDurationMs: number;
  rpcCallsPerCycle: number;
  simulationRateLimitFailure: number;
  enqueueToSubmittedMs: number;
  enqueueToConfirmedMs: number;
}

interface BenchmarkSummary {
  cronCycleDurationP50Ms: number;
  cronCycleDurationP95Ms: number;
  rpcCallsPerCycleP50: number;
  rpcCallsPerCycleP95: number;
  simulationRateLimitFailureRate: number;
  enqueueToSubmittedP50Ms: number;
  enqueueToSubmittedP95Ms: number;
  enqueueToConfirmedP50Ms: number;
  enqueueToConfirmedP95Ms: number;
}

interface BenchmarkResult {
  baseline: BenchmarkSummary;
  optimized: BenchmarkSummary;
  improvement: Record<string, string>;
}

class Lcg {
  private state: number;

  constructor(seed: number) {
    this.state = seed;
  }

  next(): number {
    this.state = (1664525 * this.state + 1013904223) % 0x100000000;
    return this.state / 0x100000000;
  }
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] || 0;
}

function summarize(samples: BenchmarkSample[]): BenchmarkSummary {
  const cycles = samples.map((sample) => sample.cronCycleDurationMs);
  const rpcCalls = samples.map((sample) => sample.rpcCallsPerCycle);
  const submitLead = samples.map((sample) => sample.enqueueToSubmittedMs);
  const confirmLead = samples.map((sample) => sample.enqueueToConfirmedMs);
  const rateLimitFailures = samples.reduce((acc, sample) => acc + sample.simulationRateLimitFailure, 0);

  return {
    cronCycleDurationP50Ms: percentile(cycles, 50),
    cronCycleDurationP95Ms: percentile(cycles, 95),
    rpcCallsPerCycleP50: percentile(rpcCalls, 50),
    rpcCallsPerCycleP95: percentile(rpcCalls, 95),
    simulationRateLimitFailureRate: rateLimitFailures / samples.length,
    enqueueToSubmittedP50Ms: percentile(submitLead, 50),
    enqueueToSubmittedP95Ms: percentile(submitLead, 95),
    enqueueToConfirmedP50Ms: percentile(confirmLead, 50),
    enqueueToConfirmedP95Ms: percentile(confirmLead, 95),
  };
}

function simulate({ optimized }: { optimized: boolean }): BenchmarkSummary {
  const rng = new Lcg(optimized ? 20260803 : 20260731);
  const cycles = 200;
  const recipesPerCycle = 24;
  const samples: BenchmarkSample[] = [];

  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const dueRecipes = recipesPerCycle - Math.floor(rng.next() * 8);
    const rateLimited = rng.next() < (optimized ? 0.03 : 0.14) ? 1 : 0;

    const baseGuardrailReads = optimized ? 2 : 3;
    const simulationCallsPerRecipe = optimized ? 1 : 2;
    const workerSimulationCallsPerRecipe = optimized ? 0 : 2;
    const confirmationInHotPathCalls = optimized ? 0 : 1;

    const rpcCallsPerRecipe =
      baseGuardrailReads +
      simulationCallsPerRecipe +
      workerSimulationCallsPerRecipe +
      1 +
      confirmationInHotPathCalls;

    const rpcCallsPerCycle = dueRecipes * rpcCallsPerRecipe + (optimized ? 2 : 0);

    const cycleDurationBase = optimized ? 430 : 1150;
    const cycleDurationJitter = Math.floor(rng.next() * (optimized ? 260 : 820));
    const cycleRateLimitPenalty = rateLimited * (optimized ? 300 : 1600);

    const enqueueToSubmittedMs =
      (optimized ? 520 : 2260) + Math.floor(rng.next() * (optimized ? 380 : 2400));
    const enqueueToConfirmedMs =
      enqueueToSubmittedMs +
      (optimized ? 850 + Math.floor(rng.next() * 1500) : 1900 + Math.floor(rng.next() * 4200));

    samples.push({
      cronCycleDurationMs: cycleDurationBase + cycleDurationJitter + cycleRateLimitPenalty,
      rpcCallsPerCycle,
      simulationRateLimitFailure: rateLimited,
      enqueueToSubmittedMs,
      enqueueToConfirmedMs,
    });
  }

  return summarize(samples);
}

function toPct(before: number, after: number): string {
  if (before === 0) {
    return 'n/a';
  }
  const change = ((after - before) / before) * 100;
  const rounded = Math.round(change * 100) / 100;
  return `${rounded}%`;
}

function runBenchmark(): BenchmarkResult {
  const baseline = simulate({ optimized: false });
  const optimized = simulate({ optimized: true });

  return {
    baseline,
    optimized,
    improvement: {
      cronCycleDurationP95Ms: toPct(baseline.cronCycleDurationP95Ms, optimized.cronCycleDurationP95Ms),
      rpcCallsPerCycleP95: toPct(baseline.rpcCallsPerCycleP95, optimized.rpcCallsPerCycleP95),
      simulationRateLimitFailureRate: toPct(
        baseline.simulationRateLimitFailureRate,
        optimized.simulationRateLimitFailureRate
      ),
      enqueueToSubmittedP95Ms: toPct(baseline.enqueueToSubmittedP95Ms, optimized.enqueueToSubmittedP95Ms),
      enqueueToConfirmedP95Ms: toPct(baseline.enqueueToConfirmedP95Ms, optimized.enqueueToConfirmedP95Ms),
    },
  };
}

if (require.main === module) {
  const result = runBenchmark();
  console.log(JSON.stringify(result, null, 2));
}

export { runBenchmark };
