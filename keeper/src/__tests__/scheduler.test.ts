import { describe, it, expect, vi } from 'vitest';
import { RecipeExecutionJobData, executeRecipeStepDirectly } from '../schedulers/queueScheduler';
import * as simulationEngine from '../simulation/staticSimulationEngine';

describe('Queue Scheduler & Job Execution', () => {
  const sampleJobData: RecipeExecutionJobData = {
    recipeId: 'test-recipe-123',
    userAddress: '0x1111111111111111111111111111111111111111',
    executorProxyAddress: '0xcbd2de404cb02c45b8688883e4321f887a6f2fc2',
    targetProtocolAddress: '0x2222222222222222222222222222222222222222',
    callData: '0xa9059cbb000000000000000000000000',
    minAmountOut: '1000000',
    keeperAddress: '0x3333333333333333333333333333333333333333',
  };

  it('should validate RecipeExecutionJobData structure', () => {
    expect(sampleJobData.recipeId).toBe('test-recipe-123');
    expect(BigInt(sampleJobData.minAmountOut)).toBe(1000000n);
    expect(sampleJobData.callData.startsWith('0x')).toBe(true);
  });

  it('should throw an error when simulation fails during direct execution', async () => {
    vi.spyOn(simulationEngine, 'simulateRecipeStep').mockResolvedValueOnce({
      success: false,
      errorMessage: 'Simulation failed: Invalid session key',
    });

    await expect(executeRecipeStepDirectly(sampleJobData)).rejects.toThrow(
      'Simulation Failed: Simulation failed: Invalid session key'
    );
  });
});
