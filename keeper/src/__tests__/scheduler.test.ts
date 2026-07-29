import { beforeEach, describe, it, expect, vi } from 'vitest';
import { RecipeExecutionJobData, executeRecipeStepDirectly } from '../schedulers/queueScheduler';
import * as simulationEngine from '../simulation/staticSimulationEngine';

const { writeContractMock, createWalletClientMock } = vi.hoisted(() => {
  return {
    writeContractMock: vi.fn(),
    createWalletClientMock: vi.fn(() => ({
      writeContract: vi.fn(),
    })),
  };
});

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createWalletClient: createWalletClientMock,
  };
});

describe('Queue Scheduler & Job Execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it('should submit tx and return execution result when simulation succeeds', async () => {
    process.env.KEEPER_PRIVATE_KEY = `0x${'1'.repeat(64)}`;

    vi.spyOn(simulationEngine, 'simulateRecipeStep').mockResolvedValueOnce({
      success: true,
      estimatedGasUsdc: 85000n,
    });

    writeContractMock.mockResolvedValue(
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    );
    createWalletClientMock.mockReturnValue({
      writeContract: writeContractMock,
    });

    vi.spyOn(simulationEngine.publicClient, 'waitForTransactionReceipt').mockResolvedValueOnce({
      blockNumber: 123n,
      status: 'success',
      gasUsed: 21000n,
    } as Awaited<ReturnType<typeof simulationEngine.publicClient.waitForTransactionReceipt>>);

    const result = await executeRecipeStepDirectly(sampleJobData);

    expect(createWalletClientMock).toHaveBeenCalledTimes(1);
    expect(writeContractMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('SIMULATED_AND_EXECUTED');
    expect(result.txHash).toBe(
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    );
    expect(result.gasUsedUsdc).toBe('85000');
  });

  it('should retry tx submission when RPC returns -32011 request limit reached', async () => {
    process.env.KEEPER_PRIVATE_KEY = `0x${'2'.repeat(64)}`;
    process.env.ARC_TESTNET_RPC_FALLBACK_URLS = 'https://rpc.testnet.arc.io,https://rpc.testnet.arc.network';

    vi.spyOn(simulationEngine, 'simulateRecipeStep').mockResolvedValueOnce({
      success: true,
      estimatedGasUsdc: 90000n,
    });

    writeContractMock
      .mockRejectedValueOnce(
        new Error(
          'could not coalesce error (error={"code":-32011,"message":"request limit reached"}, payload={"method":"eth_sendRawTransaction"})'
        )
      )
      .mockResolvedValueOnce(
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      );

    createWalletClientMock.mockReturnValue({
      writeContract: writeContractMock,
    });

    vi.spyOn(simulationEngine.publicClient, 'waitForTransactionReceipt').mockResolvedValueOnce({
      blockNumber: 124n,
      status: 'success',
      gasUsed: 21000n,
    } as Awaited<ReturnType<typeof simulationEngine.publicClient.waitForTransactionReceipt>>);

    const result = await executeRecipeStepDirectly(sampleJobData);

    expect(writeContractMock).toHaveBeenCalledTimes(2);
    expect(createWalletClientMock).toHaveBeenCalledTimes(2);
    expect(result.txHash).toBe(
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    );
  });
});
