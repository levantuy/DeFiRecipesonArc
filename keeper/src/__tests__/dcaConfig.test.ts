import { describe, expect, it } from 'vitest';
import { estimatedRuns, parseDcaConfigStateStrict } from '../domain/dcaConfig';

describe('dcaConfig parsing and validation', () => {
  it('parses total budget and per execution with 6-decimal precision', () => {
    const state = parseDcaConfigStateStrict({
      totalBudgetUsdc: '12.500001',
      perExecutionAmountUsdc: '2.500001',
      mode: 'PULL',
      spentAmountBaseUnits: '0',
      executedCount: 0,
    });

    expect(state.totalBudgetBaseUnits).toBe(12500001n);
    expect(state.perExecutionAmountBaseUnits).toBe(2500001n);
  });

  it('computes estimated runs using floor division', () => {
    const state = parseDcaConfigStateStrict({
      totalBudgetUsdc: '10',
      perExecutionAmountUsdc: '3',
      mode: 'PULL',
    });

    expect(estimatedRuns(state)).toBe(3n);
  });

  it('rejects per execution amount above total budget', () => {
    expect(() =>
      parseDcaConfigStateStrict({
        totalBudgetUsdc: '5',
        perExecutionAmountUsdc: '6',
        mode: 'PULL',
      })
    ).toThrow('perExecutionAmount cannot exceed totalBudget');
  });
});
