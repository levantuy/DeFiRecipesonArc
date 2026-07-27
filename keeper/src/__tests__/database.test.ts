import { describe, it, expect } from 'vitest';
import { RecipeType, RecipeStatus, ExecutionStatus } from '@prisma/client';

describe('Database Enum & Model Definitions', () => {
  it('should include all required RecipeType enums', () => {
    expect(RecipeType.AUTO_COMPOUNDER).toBe('AUTO_COMPOUNDER');
    expect(RecipeType.RECURRING_DCA).toBe('RECURRING_DCA');
    expect(RecipeType.SMART_YIELD_REBALANCER).toBe('SMART_YIELD_REBALANCER');
    expect(RecipeType.SAFETY_NET).toBe('SAFETY_NET');
    expect(RecipeType.SAVINGS_STREAM).toBe('SAVINGS_STREAM');
  });

  it('should include all required RecipeStatus enums', () => {
    expect(RecipeStatus.ACTIVE).toBe('ACTIVE');
    expect(RecipeStatus.PAUSED).toBe('PAUSED');
    expect(RecipeStatus.COMPLETED).toBe('COMPLETED');
    expect(RecipeStatus.CANCELLED).toBe('CANCELLED');
  });

  it('should include all required ExecutionStatus enums', () => {
    expect(ExecutionStatus.SIMULATING).toBe('SIMULATING');
    expect(ExecutionStatus.SUBMITTED).toBe('SUBMITTED');
    expect(ExecutionStatus.CONFIRMED).toBe('CONFIRMED');
    expect(ExecutionStatus.SIMULATION_FAILED).toBe('SIMULATION_FAILED');
    expect(ExecutionStatus.REVERTED).toBe('REVERTED');
  });
});
