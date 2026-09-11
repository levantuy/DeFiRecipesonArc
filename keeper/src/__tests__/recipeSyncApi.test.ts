import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecipeStatus, RecipeType } from '../db/types';

const { getBytecodeMock } = vi.hoisted(() => ({
  getBytecodeMock: vi.fn(),
}));

const { readContractMock } = vi.hoisted(() => ({
  readContractMock: vi.fn(),
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
    readContract: readContractMock,
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

import { getSessionSpendQuota, registerOrActivateRecipe } from '../api/recipeSyncApi';

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
      swapProvider: 'ARC_LIFI_SWAP',
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
      swapProvider: 'ARC_LIFI_SWAP',
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
      swapProvider: 'ARC_LIFI_SWAP',
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
        swapProvider: 'ARC_LIFI_SWAP',
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
        swapProvider: 'ARC_LIFI_SWAP',
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
        swapProvider: 'ARC_LIFI_SWAP',
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
        swapProvider: 'ARC_LIFI_SWAP',
        parametersJson: {
          perExecutionAmountUsdc: '5',
          mode: 'PULL',
        },
      })
    ).rejects.toThrow('requires totalBudgetUsdc and perExecutionAmountUsdc');
  });
});

describe('recipeSyncApi session spend quota', () => {
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

  it('defaults sessionSpendLimitUsdc to 500 and persists canonical fields with legacy alias', async () => {
    await registerOrActivateRecipe({
      userAddress: '0x1111111111111111111111111111111111111111',
      recipeType: 'AUTO_COMPOUNDER',
      targetProtocol: '0x5555555555555555555555555555555555555555',
      parametersJson: {},
    });

    expect(createWithUserConnectOrCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        parametersJson: expect.objectContaining({
          sessionSpendLimitUsdc: '500',
          sessionSpendLimitBaseUnits: '500000000',
          maxUsdcSpendLimit: '500',
        }),
      })
    );
  });

  it('persists a custom sessionSpendLimitUsdc with 6-decimal precision', async () => {
    await registerOrActivateRecipe({
      userAddress: '0x1111111111111111111111111111111111111111',
      recipeType: 'AUTO_COMPOUNDER',
      targetProtocol: '0x5555555555555555555555555555555555555555',
      parametersJson: {
        sessionSpendLimitUsdc: '123.456789',
      },
    });

    expect(createWithUserConnectOrCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        parametersJson: expect.objectContaining({
          sessionSpendLimitUsdc: '123.456789',
          sessionSpendLimitBaseUnits: '123456789',
        }),
      })
    );
  });

  it('falls back to legacy maxUsdcSpendLimit alias when canonical field is absent', async () => {
    await registerOrActivateRecipe({
      userAddress: '0x1111111111111111111111111111111111111111',
      recipeType: 'AUTO_COMPOUNDER',
      targetProtocol: '0x5555555555555555555555555555555555555555',
      parametersJson: {
        maxUsdcSpendLimit: '750',
      },
    });

    expect(createWithUserConnectOrCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        parametersJson: expect.objectContaining({
          sessionSpendLimitUsdc: '750',
          maxUsdcSpendLimit: '750',
        }),
      })
    );
  });

  it.each([
    ['', 'sessionSpendLimitUsdc is required'],
    ['0', 'sessionSpendLimitUsdc must be greater than 0'],
    ['-5', 'sessionSpendLimitUsdc must be numeric with up to 6 decimals'],
    ['abc', 'sessionSpendLimitUsdc must be numeric with up to 6 decimals'],
    ['1.1234567', 'sessionSpendLimitUsdc must be numeric with up to 6 decimals'],
    ['2000000', 'sessionSpendLimitUsdc must be between 1 and 1000000 USDC'],
  ])('rejects invalid sessionSpendLimitUsdc value %s', async (value, expectedMessage) => {
    await expect(
      registerOrActivateRecipe({
        userAddress: '0x1111111111111111111111111111111111111111',
        recipeType: 'AUTO_COMPOUNDER',
        targetProtocol: '0x5555555555555555555555555555555555555555',
        parametersJson: {
          sessionSpendLimitUsdc: value,
        },
      })
    ).rejects.toThrow(expectedMessage);
  });
});

describe('recipeSyncApi getSessionSpendQuota', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns remaining quota derived from on-chain permission snapshot', async () => {
    readContractMock.mockResolvedValue({
      sessionKey: '0x2222222222222222222222222222222222222222',
      validUntil: 4102444800n,
      maxUsdcSpendLimit: 500000000n,
      currentUsdcSpent: 125000000n,
      revoked: false,
      exists: true,
    });

    const result = await getSessionSpendQuota({
      userAddress: '0x1111111111111111111111111111111111111111',
      sessionKeyAddress: '0x2222222222222222222222222222222222222222',
    });

    expect(result.success).toBe(true);
    expect(result.quota).toMatchObject({
      exists: true,
      revoked: false,
      maxUsdcSpendLimit: '500',
      currentUsdcSpent: '125',
      remainingUsdcSpendLimit: '375',
    });
  });

  it('clamps remaining quota to 0 when currentUsdcSpent meets or exceeds maxUsdcSpendLimit', async () => {
    readContractMock.mockResolvedValue({
      sessionKey: '0x2222222222222222222222222222222222222222',
      validUntil: 4102444800n,
      maxUsdcSpendLimit: 500000000n,
      currentUsdcSpent: 500000000n,
      revoked: false,
      exists: true,
    });

    const result = await getSessionSpendQuota({
      userAddress: '0x1111111111111111111111111111111111111111',
      sessionKeyAddress: '0x2222222222222222222222222222222222222222',
    });

    expect(result.quota).toMatchObject({
      remainingUsdcSpendLimit: '0',
    });
  });

  it('rejects missing userAddress', async () => {
    await expect(getSessionSpendQuota({})).rejects.toThrow('userAddress must be a valid 20-byte hex address.');
  });
});
