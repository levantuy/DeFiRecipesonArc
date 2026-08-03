import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecipeStatus, RecipeType } from '../db/types';

const { findByStatusMock, queueAddMock, simulateRecipeStepMock, getBytecodeMock, readContractMock, dcaResolveRouteMock } = vi.hoisted(() => {
  return {
    findByStatusMock: vi.fn(),
    queueAddMock: vi.fn(),
    simulateRecipeStepMock: vi.fn(),
    getBytecodeMock: vi.fn(),
    readContractMock: vi.fn(),
    dcaResolveRouteMock: vi.fn(),
  };
});

vi.mock('../db/repositories/recipesRepository', () => ({
  recipesRepository: {
    findByStatus: findByStatusMock,
  },
}));

vi.mock('../schedulers/queueScheduler', () => ({
  recipeQueue: {
    add: queueAddMock,
  },
}));

vi.mock('../simulation/staticSimulationEngine', () => ({
  simulateRecipeStep: simulateRecipeStepMock,
  publicClient: {
    getBytecode: getBytecodeMock,
    readContract: readContractMock,
  },
}));

vi.mock('../index', () => ({
  getKeeperAccount: () => ({
    address: '0x3333333333333333333333333333333333333333',
  }),
}));

vi.mock('../integrations/circle/dcaSwapRouteClient', () => ({
  createDcaSwapRouteClientFromRuntime: () => ({
    resolveRoute: dcaResolveRouteMock,
  }),
}));

import { __resetCronSchedulerStateForTests, pollAndTriggerActiveRecipes } from '../schedulers/cronScheduler';

function makeActiveRecipe(overrides: Record<string, unknown>) {
  return {
    id: 'recipe-1',
    userAddress: '0x1111111111111111111111111111111111111111',
    recipeType: RecipeType.AUTO_COMPOUNDER,
    status: RecipeStatus.ACTIVE,
    targetProtocol: '0x2222222222222222222222222222222222222222',
    parametersJson: {},
    lastExecutedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    ...overrides,
  };
}

describe('Cron Scheduler Recipe Triggering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetCronSchedulerStateForTests();
    findByStatusMock.mockResolvedValue([]);
    simulateRecipeStepMock.mockResolvedValue({ success: true, estimatedGasUsdc: 90000n });
    getBytecodeMock.mockResolvedValue('0x1234');
    readContractMock.mockResolvedValue(true);
    dcaResolveRouteMock.mockResolvedValue({
      targetProtocolAddress: '0x5555555555555555555555555555555555555555',
      callData: '0x12345678',
      minSwapAssetOutBaseUnits: 49500000n,
    });
  });

  it('logs actionable hint and skips enqueue when simulation fails with UnauthorizedKeeper', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    findByStatusMock.mockResolvedValue([
      makeActiveRecipe({
        id: 'unauthorized-keeper',
        recipeType: RecipeType.AUTO_COMPOUNDER,
      }),
    ]);
    simulateRecipeStepMock.mockResolvedValue({
      success: false,
      errorMessage: 'Execution reverted: UnauthorizedKeeper()',
    });

    await pollAndTriggerActiveRecipes();
    await pollAndTriggerActiveRecipes();

    expect(queueAddMock).not.toHaveBeenCalled();
    const actionRequiredWarnings = warnSpy.mock.calls
      .flatMap((call) => call)
      .filter((value) =>
        typeof value === 'string' && value.includes('Keeper session key is not valid for this user')
      );
    expect(actionRequiredWarnings).toHaveLength(1);

    warnSpy.mockRestore();
  });

  it('enqueues DCA recipe with normalized 6-decimal USDC spend value', async () => {
    findByStatusMock.mockResolvedValue([
      makeActiveRecipe({
        id: 'dca-1',
        recipeType: RecipeType.RECURRING_DCA,
        swapProvider: 'ARC_APP_KIT_SWAP',
        parametersJson: { dcaAmountUsdc: '50' },
      }),
    ]);

    await pollAndTriggerActiveRecipes();

    expect(dcaResolveRouteMock).toHaveBeenCalledTimes(1);
    expect(dcaResolveRouteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        amountInBaseUnits: 50000000n,
        maxSlippageBps: 100,
        targetAssetSymbol: 'cirBTC',
      })
    );

    expect(simulateRecipeStepMock).toHaveBeenCalledTimes(1);
    const simReq = simulateRecipeStepMock.mock.calls[0][0];
    expect(simReq.minAmountOut).toBe(50000000n);
    expect(simReq.callData).toBe('0x12345678');

    expect(queueAddMock).toHaveBeenCalledTimes(1);
    const jobData = queueAddMock.mock.calls[0][1];
    expect(jobData.recipeId).toBe('dca-1');
    expect(jobData.minAmountOut).toBe('50000000');
  });

  it('applies dynamic maxSlippageBps from parametersJson when resolving DCA route', async () => {
    findByStatusMock.mockResolvedValue([
      makeActiveRecipe({
        id: 'dca-dynamic-slippage',
        recipeType: RecipeType.RECURRING_DCA,
        swapProvider: 'ARC_APP_KIT_SWAP',
        parametersJson: { dcaAmountUsdc: '50', maxSlippageBps: 250 },
      }),
    ]);

    await pollAndTriggerActiveRecipes();

    expect(dcaResolveRouteMock).toHaveBeenCalledTimes(1);
    expect(dcaResolveRouteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        amountInBaseUnits: 50000000n,
        maxSlippageBps: 250,
        targetAssetSymbol: 'cirBTC',
      })
    );
  });

  it('skips DCA recipe when checkIntervalHours has not elapsed', async () => {
    findByStatusMock.mockResolvedValue([
      makeActiveRecipe({
        id: 'dca-not-due',
        recipeType: RecipeType.RECURRING_DCA,
        swapProvider: 'ARC_APP_KIT_SWAP',
        parametersJson: { dcaAmountUsdc: '50', checkIntervalHours: 24 },
        lastExecutedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      }),
    ]);

    await pollAndTriggerActiveRecipes();

    expect(simulateRecipeStepMock).not.toHaveBeenCalled();
    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it('resolves missing DCA targetProtocol from App Kit runtime route', async () => {
    findByStatusMock.mockResolvedValue([
      makeActiveRecipe({
        id: 'dca-route-resolved',
        recipeType: RecipeType.RECURRING_DCA,
        targetProtocol: null,
        swapProvider: 'ARC_APP_KIT_SWAP',
        parametersJson: { dcaAmountUsdc: '50', maxSlippageBps: 100 },
      }),
    ]);

    await pollAndTriggerActiveRecipes();

    expect(dcaResolveRouteMock).toHaveBeenCalledTimes(1);
    expect(simulateRecipeStepMock).toHaveBeenCalledTimes(1);
    const simReq = simulateRecipeStepMock.mock.calls[0][0];
    expect(simReq.targetProtocolAddress).toBe('0x5555555555555555555555555555555555555555');
    expect(simReq.callData).toBe('0x12345678');
    expect(queueAddMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to configured targetProtocol when App Kit reports no route available', async () => {
    dcaResolveRouteMock.mockRejectedValueOnce(
      new Error('Arc App Kit swap service request failed: {"code":331001,"message":"No route available"}')
    );

    findByStatusMock.mockResolvedValue([
      makeActiveRecipe({
        id: 'dca-no-route-fallback',
        recipeType: RecipeType.RECURRING_DCA,
        targetProtocol: '0x6666666666666666666666666666666666666666',
        swapProvider: 'ARC_APP_KIT_SWAP',
        parametersJson: {
          dcaAmountUsdc: '50',
          maxSlippageBps: 100,
          targetAssetSymbol: 'cirBTC',
        },
      }),
    ]);

    await pollAndTriggerActiveRecipes();

    expect(dcaResolveRouteMock).toHaveBeenCalledTimes(1);
    expect(simulateRecipeStepMock).toHaveBeenCalledTimes(1);

    const simReq = simulateRecipeStepMock.mock.calls[0][0];
    expect(simReq.targetProtocolAddress).toBe('0x6666666666666666666666666666666666666666');
    expect(typeof simReq.callData).toBe('string');
    expect(simReq.callData.startsWith('0x38ed1739')).toBe(true);
    expect(simReq.minAmountOut).toBe(50000000n);

    expect(queueAddMock).toHaveBeenCalledTimes(1);
    const jobData = queueAddMock.mock.calls[0][1];
    expect(jobData.recipeId).toBe('dca-no-route-fallback');
  });

  it('skips invalid recipe parameters without stopping other due recipes', async () => {
    findByStatusMock.mockResolvedValue([
      makeActiveRecipe({
        id: 'bad-dca',
        recipeType: RecipeType.RECURRING_DCA,
        parametersJson: { dcaAmountUsdc: '-1' },
      }),
      makeActiveRecipe({
        id: 'good-compounder',
        recipeType: RecipeType.AUTO_COMPOUNDER,
      }),
    ]);

    await pollAndTriggerActiveRecipes();

    expect(simulateRecipeStepMock).toHaveBeenCalledTimes(1);
    expect(queueAddMock).toHaveBeenCalledTimes(1);

    const jobData = queueAddMock.mock.calls[0][1];
    expect(jobData.recipeId).toBe('good-compounder');
  });

  it('logs action required and skips enqueue when selector is not allowed by guardrail', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    findByStatusMock.mockResolvedValue([
      makeActiveRecipe({
        id: 'selector-blocked',
        recipeType: RecipeType.AUTO_COMPOUNDER,
        targetProtocol: '0x4444444444444444444444444444444444444444',
      }),
    ]);
    readContractMock
      .mockResolvedValueOnce(1000000n) // claimableRewards
      .mockResolvedValueOnce('0x9999999999999999999999999999999999999999') // guardrail owner
      .mockResolvedValueOnce(true) // protocol whitelisted
      .mockResolvedValueOnce(false); // selector blocked

    await pollAndTriggerActiveRecipes();
    await pollAndTriggerActiveRecipes();

    expect(simulateRecipeStepMock).not.toHaveBeenCalled();
    expect(queueAddMock).not.toHaveBeenCalled();

    const actionRequiredWarnings = warnSpy.mock.calls
      .flatMap((call) => call)
      .filter((value) => typeof value === 'string' && value.includes('Guardrail blocks selector'));
    expect(actionRequiredWarnings).toHaveLength(1);

    warnSpy.mockRestore();
  });
});
