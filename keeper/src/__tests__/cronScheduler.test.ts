import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecipeStatus, RecipeType } from '@prisma/client';

const { findManyMock, queueAddMock, simulateRecipeStepMock, getBytecodeMock, readContractMock } = vi.hoisted(() => {
  return {
    findManyMock: vi.fn(),
    queueAddMock: vi.fn(),
    simulateRecipeStepMock: vi.fn(),
    getBytecodeMock: vi.fn(),
    readContractMock: vi.fn(),
  };
});

vi.mock('@prisma/client', async () => {
  const actual = await vi.importActual<typeof import('@prisma/client')>('@prisma/client');

  class PrismaClientMock {
    activeRecipe = {
      findMany: findManyMock,
    };
  }

  return {
    ...actual,
    PrismaClient: PrismaClientMock,
  };
});

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

import { pollAndTriggerActiveRecipes } from '../schedulers/cronScheduler';

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
    simulateRecipeStepMock.mockResolvedValue({ success: true, estimatedGasUsdc: 90000n });
    getBytecodeMock.mockResolvedValue('0x1234');
    readContractMock.mockResolvedValue(true);
  });

  it('logs actionable hint and skips enqueue when simulation fails with UnauthorizedKeeper', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    findManyMock.mockResolvedValue([
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
    findManyMock.mockResolvedValue([
      makeActiveRecipe({
        id: 'dca-1',
        recipeType: RecipeType.RECURRING_DCA,
        parametersJson: { dcaAmountUsdc: '50' },
      }),
    ]);

    await pollAndTriggerActiveRecipes();

    expect(simulateRecipeStepMock).toHaveBeenCalledTimes(1);
    const simReq = simulateRecipeStepMock.mock.calls[0][0];
    expect(simReq.minAmountOut).toBe(50000000n);

    expect(queueAddMock).toHaveBeenCalledTimes(1);
    const jobData = queueAddMock.mock.calls[0][1];
    expect(jobData.recipeId).toBe('dca-1');
    expect(jobData.minAmountOut).toBe('50000000');
  });

  it('skips invalid recipe parameters without stopping other due recipes', async () => {
    findManyMock.mockResolvedValue([
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
    findManyMock.mockResolvedValue([
      makeActiveRecipe({
        id: 'selector-blocked',
        recipeType: RecipeType.AUTO_COMPOUNDER,
        targetProtocol: '0x4444444444444444444444444444444444444444',
      }),
    ]);
    readContractMock.mockResolvedValue(false);

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
