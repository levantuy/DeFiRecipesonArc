import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecipeStatus, RecipeType } from '../db/types';

const { getBytecodeMock } = vi.hoisted(() => ({
  getBytecodeMock: vi.fn(),
}));

const {
  findMatchingForRegistrationMock,
  createWithUserConnectOrCreateMock,
} = vi.hoisted(() => ({
  findMatchingForRegistrationMock: vi.fn(),
  createWithUserConnectOrCreateMock: vi.fn(),
}));

vi.mock('../simulation/staticSimulationEngine', () => ({
  publicClient: {
    getBytecode: getBytecodeMock,
  },
}));

vi.mock('../db/repositories/recipesRepository', () => ({
  recipesRepository: {
    findMatchingForRegistration: findMatchingForRegistrationMock,
    createWithUserConnectOrCreate: createWithUserConnectOrCreateMock,
    updateForActivation: vi.fn(),
    findLatestByUserAndType: vi.fn(),
    updateStatus: vi.fn(),
  },
}));

import { registerOrActivateRecipe } from '../api/recipeSyncApi';

describe('recipeSyncApi register validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBytecodeMock.mockResolvedValue('0x1234');
    findMatchingForRegistrationMock.mockResolvedValue(null);
    createWithUserConnectOrCreateMock.mockImplementation(async ({
      userAddress,
      recipeType,
      targetProtocol,
      swapProvider,
    }: {
      userAddress: string;
      recipeType: RecipeType;
      targetProtocol: string | null;
      swapProvider: string | null;
    }) => ({
      id: 'recipe-created',
      userAddress,
      recipeType,
      status: RecipeStatus.ACTIVE,
      targetProtocol,
      swapProvider,
    }));
  });

  it('accepts RECURRING_DCA registration with swapProvider-only payload', async () => {
    const result = await registerOrActivateRecipe({
      userAddress: '0x1111111111111111111111111111111111111111',
      recipeType: 'RECURRING_DCA',
      swapProvider: 'ARC_APP_KIT_SWAP',
      parametersJson: {
        maxSlippageBps: 100,
        totalBudgetUsdc: '50',
        perExecutionAmountUsdc: '5',
        mode: 'PULL',
      },
    });

    expect(result.success).toBe(true);
    expect(result.recipe).toMatchObject({
      targetProtocol: null,
      swapProvider: 'ARC_APP_KIT_SWAP',
    });
    expect(createWithUserConnectOrCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        parametersJson: expect.objectContaining({
          maxSlippageBps: 100,
          targetAssetSymbol: 'EURC',
          totalBudgetUsdc: '50',
          perExecutionAmountUsdc: '5',
          mode: 'PULL',
        }),
      })
    );
  });

  it('rejects RECURRING_DCA registration when targetProtocol is provided', async () => {
    await expect(
      registerOrActivateRecipe({
        userAddress: '0x1111111111111111111111111111111111111111',
        recipeType: 'RECURRING_DCA',
        targetProtocol: '0x5555555555555555555555555555555555555555',
        parametersJson: {
          maxSlippageBps: 100,
          totalBudgetUsdc: '50',
          perExecutionAmountUsdc: '5',
          mode: 'PULL',
        },
      })
    ).rejects.toThrow('RECURRING_DCA does not accept targetProtocol');
  });

  it('normalizes provided targetAssetSymbol for RECURRING_DCA', async () => {
    await registerOrActivateRecipe({
      userAddress: '0x1111111111111111111111111111111111111111',
      recipeType: 'RECURRING_DCA',
      swapProvider: 'ARC_APP_KIT_SWAP',
      parametersJson: {
        totalBudgetUsdc: '50',
        perExecutionAmountUsdc: '5',
        mode: 'PULL',
        targetAssetSymbol: 'eurc',
      },
    });

    expect(createWithUserConnectOrCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        parametersJson: expect.objectContaining({
          targetAssetSymbol: 'EURC',
        }),
      })
    );
  });

  it('rejects unsupported targetAssetSymbol for RECURRING_DCA', async () => {
    await expect(
      registerOrActivateRecipe({
        userAddress: '0x1111111111111111111111111111111111111111',
        recipeType: 'RECURRING_DCA',
        swapProvider: 'ARC_APP_KIT_SWAP',
        parametersJson: {
          totalBudgetUsdc: '50',
          perExecutionAmountUsdc: '5',
          mode: 'PULL',
          targetAssetSymbol: 'WETH',
        },
      })
    ).rejects.toThrow('targetAssetSymbol must be one of: USDC, EURC, cirBTC');
  });

  it('rejects out-of-range maxSlippageBps for RECURRING_DCA', async () => {
    await expect(
      registerOrActivateRecipe({
        userAddress: '0x1111111111111111111111111111111111111111',
        recipeType: 'RECURRING_DCA',
        swapProvider: 'ARC_APP_KIT_SWAP',
        parametersJson: {
          maxSlippageBps: 5000,
          totalBudgetUsdc: '50',
          perExecutionAmountUsdc: '5',
          mode: 'PULL',
        },
      })
    ).rejects.toThrow('maxSlippageBps must be between 10 and 1000');
  });

  it('rejects DCA when perExecutionAmountUsdc exceeds totalBudgetUsdc', async () => {
    await expect(
      registerOrActivateRecipe({
        userAddress: '0x1111111111111111111111111111111111111111',
        recipeType: 'RECURRING_DCA',
        swapProvider: 'ARC_APP_KIT_SWAP',
        parametersJson: {
          totalBudgetUsdc: '10',
          perExecutionAmountUsdc: '20',
          mode: 'PULL',
        },
      })
    ).rejects.toThrow('perExecutionAmount cannot exceed totalBudget');
  });

  it('rejects DCA when totalBudgetUsdc is missing', async () => {
    await expect(
      registerOrActivateRecipe({
        userAddress: '0x1111111111111111111111111111111111111111',
        recipeType: 'RECURRING_DCA',
        swapProvider: 'ARC_APP_KIT_SWAP',
        parametersJson: {
          perExecutionAmountUsdc: '5',
          mode: 'PULL',
        },
      })
    ).rejects.toThrow('requires totalBudgetUsdc and perExecutionAmountUsdc');
  });
});
