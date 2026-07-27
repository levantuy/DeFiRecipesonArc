import { describe, it, expect, vi } from 'vitest';
import { simulateRecipeStep, SimulationRequest, publicClient } from '../simulation/staticSimulationEngine';

describe('Static Simulation Engine', () => {
  const dummyRequest: SimulationRequest = {
    userAddress: '0x1111111111111111111111111111111111111111',
    targetProtocolAddress: '0x2222222222222222222222222222222222222222',
    callData: '0x12345678',
    minAmountOut: 1000000n,
    keeperAddress: '0x3333333333333333333333333333333333333333',
  };

  it('should format simulation request structure correctly', () => {
    expect(dummyRequest.userAddress).toBeDefined();
    expect(dummyRequest.minAmountOut).toBe(1000000n);
    expect(dummyRequest.callData).toBe('0x12345678');
  });

  it('should handle simulation errors gracefully when contract execution reverts or fails', async () => {
    vi.spyOn(publicClient, 'simulateContract').mockRejectedValueOnce(
      new Error('Execution reverted: Guardrail: Protocol not whitelisted')
    );

    const result = await simulateRecipeStep(dummyRequest);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('Guardrail: Protocol not whitelisted');
  });

  it('should return estimated gas when simulation succeeds', async () => {
    vi.spyOn(publicClient, 'simulateContract').mockResolvedValueOnce({
      result: null,
      request: {},
    } as any);
    vi.spyOn(publicClient, 'estimateContractGas').mockResolvedValueOnce(85000n);

    const result = await simulateRecipeStep(dummyRequest);
    expect(result.success).toBe(true);
    expect(result.estimatedGasUsdc).toBe(85000n);
  });
});
