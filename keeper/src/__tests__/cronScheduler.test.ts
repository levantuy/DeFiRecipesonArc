import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeFunctionData } from 'viem';
import { RecipeStatus, RecipeType } from '../db/types';
import { RUNTIME_CONFIG } from '../config/runtime';

const {
  findByStatusMock,
  updateParametersJsonMock,
  queueAddMock,
  simulateRecipeStepMock,
  getBytecodeMock,
  readContractMock,
  dcaResolveRouteMock,
  waitForTransactionReceiptMock,
  writeContractMock,
} = vi.hoisted(() => {
  return {
    findByStatusMock: vi.fn(),
    updateParametersJsonMock: vi.fn(),
    queueAddMock: vi.fn(),
    simulateRecipeStepMock: vi.fn(),
    getBytecodeMock: vi.fn(),
    readContractMock: vi.fn(),
    dcaResolveRouteMock: vi.fn(),
    waitForTransactionReceiptMock: vi.fn(),
    writeContractMock: vi.fn(),
  };
});

vi.mock('../db/repositories/recipesRepository', () => ({
  recipesRepository: {
    findByStatus: findByStatusMock,
    updateParametersJson: updateParametersJsonMock,
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
    waitForTransactionReceipt: waitForTransactionReceiptMock,
  },
}));

vi.mock('../index', () => ({
  getKeeperAccount: () => ({
    address: '0x3333333333333333333333333333333333333333',
  }),
  getKeeperWalletClient: () => ({
    writeContract: writeContractMock,
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
    updateParametersJsonMock.mockResolvedValue(undefined);
    simulateRecipeStepMock.mockResolvedValue({ success: true, estimatedGasUsdc: 90000n });
    getBytecodeMock.mockResolvedValue('0x1234');
    readContractMock.mockResolvedValue(true);
    waitForTransactionReceiptMock.mockResolvedValue({ status: 'success' });
    writeContractMock.mockResolvedValue('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    RUNTIME_CONFIG.allowAppKitDcaGuardrailBypass = false;
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
        parametersJson: { totalBudgetUsdc: '500', perExecutionAmountUsdc: '50', mode: 'PULL' },
      }),
    ]);

    await pollAndTriggerActiveRecipes();

    expect(dcaResolveRouteMock).toHaveBeenCalledTimes(1);
    expect(dcaResolveRouteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        amountInBaseUnits: 50000000n,
        maxSlippageBps: 100,
        targetAssetSymbol: 'EURC',
      })
    );
    expect(updateParametersJsonMock).toHaveBeenCalledWith(
      'dca-1',
      expect.objectContaining({
        totalBudgetUsdc: '500',
        perExecutionAmountUsdc: '50',
        mode: 'PULL',
        targetAssetSymbol: 'EURC',
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
        parametersJson: { totalBudgetUsdc: '500', perExecutionAmountUsdc: '50', mode: 'PULL', maxSlippageBps: 250 },
      }),
    ]);

    await pollAndTriggerActiveRecipes();

    expect(dcaResolveRouteMock).toHaveBeenCalledTimes(1);
    expect(dcaResolveRouteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        amountInBaseUnits: 50000000n,
        maxSlippageBps: 250,
        targetAssetSymbol: 'EURC',
      })
    );
  });

  it('skips DCA recipe when checkIntervalHours has not elapsed', async () => {
    findByStatusMock.mockResolvedValue([
      makeActiveRecipe({
        id: 'dca-not-due',
        recipeType: RecipeType.RECURRING_DCA,
        swapProvider: 'ARC_APP_KIT_SWAP',
        parametersJson: { totalBudgetUsdc: '500', perExecutionAmountUsdc: '50', mode: 'PULL', checkIntervalHours: 24 },
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
        parametersJson: { totalBudgetUsdc: '500', perExecutionAmountUsdc: '50', mode: 'PULL', maxSlippageBps: 100 },
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

  it('skips DCA enqueue when App Kit reports no route available', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
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
          totalBudgetUsdc: '500',
          perExecutionAmountUsdc: '50',
          mode: 'PULL',
          maxSlippageBps: 100,
          targetAssetSymbol: 'cirBTC',
        },
      }),
    ]);

    await pollAndTriggerActiveRecipes();

    expect(dcaResolveRouteMock).toHaveBeenCalledTimes(1);
    expect(simulateRecipeStepMock).not.toHaveBeenCalled();
    expect(queueAddMock).not.toHaveBeenCalled();

    const actionRequiredWarnings = warnSpy.mock.calls
      .flatMap((call) => call)
      .filter((value) => typeof value === 'string' && value.includes('App Kit has no swap route'));
    expect(actionRequiredWarnings).toHaveLength(1);

    warnSpy.mockRestore();
  });

  it('skips invalid recipe parameters without stopping other due recipes', async () => {
    findByStatusMock.mockResolvedValue([
      makeActiveRecipe({
        id: 'bad-dca',
        recipeType: RecipeType.RECURRING_DCA,
        parametersJson: { totalBudgetUsdc: '-1', perExecutionAmountUsdc: '1', mode: 'PULL' },
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

  it('bypasses guardrail whitelist checks for App Kit DCA when runtime flag is enabled', async () => {
    RUNTIME_CONFIG.allowAppKitDcaGuardrailBypass = true;
    readContractMock
      .mockResolvedValueOnce(50000000n) // USDC balance precheck
      .mockResolvedValueOnce(50000000n) // USDC allowance precheck (route spender)
      .mockResolvedValueOnce(50000000n) // USDC allowance precheck (shared executor)
      .mockResolvedValueOnce('0x3333333333333333333333333333333333333333') // guardrail owner
      .mockResolvedValueOnce(false) // protocol not allowed (auto-whitelist branch)
      .mockResolvedValueOnce(false) // selector not allowed (auto-whitelist branch)
      .mockResolvedValueOnce(true) // protocol allowed after auto-whitelist
      .mockResolvedValueOnce(true); // selector allowed after auto-whitelist

    findByStatusMock.mockResolvedValue([
      makeActiveRecipe({
        id: 'dca-guardrail-bypass',
        recipeType: RecipeType.RECURRING_DCA,
        swapProvider: 'ARC_APP_KIT_SWAP',
        parametersJson: { totalBudgetUsdc: '500', perExecutionAmountUsdc: '50', mode: 'PULL', maxSlippageBps: 100, targetAssetSymbol: 'EURC' },
      }),
    ]);

    await pollAndTriggerActiveRecipes();

    expect(dcaResolveRouteMock).toHaveBeenCalledTimes(1);
    expect(writeContractMock).toHaveBeenCalledTimes(2);
    expect(simulateRecipeStepMock).toHaveBeenCalledTimes(1);
    expect(queueAddMock).toHaveBeenCalledTimes(1);
  });

  it('uses the reverted contract address from simulation errors as an allowance check target', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    dcaResolveRouteMock.mockResolvedValue({
      targetProtocolAddress: '0x7777777777777777777777777777777777777777',
      callData: '0x12345678',
      minSwapAssetOutBaseUnits: 49500000n,
      spenderAddress: '0x8888888888888888888888888888888888888888',
    });

    findByStatusMock.mockResolvedValue([
      makeActiveRecipe({
        id: 'dca-reverted-contract-address',
        recipeType: RecipeType.RECURRING_DCA,
        swapProvider: 'ARC_APP_KIT_SWAP',
        parametersJson: { totalBudgetUsdc: '100', perExecutionAmountUsdc: '5', mode: 'PULL', maxSlippageBps: 100, targetAssetSymbol: 'EURC' },
      }),
    ]);

    readContractMock.mockImplementation(async (request: Record<string, unknown>) => {
      const functionName = request.functionName as string;
      if (functionName === 'balanceOf') {
        return 5000000n;
      }

      if (functionName === 'allowance') {
        const args = request.args as unknown[];
        const spender = String(args[1] || '').toLowerCase();
        if (spender === '0x1111111111111111111111111111111111111111') {
          return 1000000n;
        }
        return 5000000n;
      }

      return true;
    });

    simulateRecipeStepMock.mockResolvedValue({
      success: false,
      errorMessage: 'execution reverted: ERC20: transfer amount exceeds allowance\nContract Call:\n  address:   0x1111111111111111111111111111111111111111\n  function:  executeRecipeStep(address user, address targetProtocol, bytes callData, uint256 minAmountOut)',
    });

    await pollAndTriggerActiveRecipes();

    const allowanceWarnings = warnSpy.mock.calls
      .map((call) => call.map((value) => String(value)).join(' '))
      .filter((value) => value.includes('DCA allowance is lower than configured spend') || value.includes('DCA simulation reverted with allowance error'));

    expect(allowanceWarnings.length).toBeGreaterThan(0);
    expect(allowanceWarnings[0]).toContain('spender=0x1111111111111111111111111111111111111111');

    warnSpy.mockRestore();
  });

  it('logs DCA allowance warning once with explicit spender address', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    dcaResolveRouteMock.mockResolvedValue({
      targetProtocolAddress: '0x7777777777777777777777777777777777777777',
      callData: '0x12345678',
      minSwapAssetOutBaseUnits: 49500000n,
      spenderAddress: '0x8888888888888888888888888888888888888888',
    });

    findByStatusMock.mockResolvedValue([
      makeActiveRecipe({
        id: 'dca-allowance-low',
        recipeType: RecipeType.RECURRING_DCA,
        swapProvider: 'ARC_APP_KIT_SWAP',
        parametersJson: { totalBudgetUsdc: '100', perExecutionAmountUsdc: '5', mode: 'PULL', maxSlippageBps: 100, targetAssetSymbol: 'EURC' },
      }),
    ]);

    readContractMock.mockImplementation(async (request: Record<string, unknown>) => {
      const functionName = request.functionName as string;
      if (functionName === 'balanceOf') {
        return 5000000n;
      }

      if (functionName === 'allowance') {
        const args = request.args as unknown[];
        const spender = String(args[1] || '').toLowerCase();
        if (spender === '0x8888888888888888888888888888888888888888') {
          return 1000000n;
        }
        return 5000000n;
      }

      return true;
    });

    simulateRecipeStepMock.mockResolvedValue({
      success: false,
      errorMessage: 'execution reverted: ERC20: transfer amount exceeds allowance',
    });

    await pollAndTriggerActiveRecipes();
    await pollAndTriggerActiveRecipes();

    const allowanceWarnings = warnSpy.mock.calls
      .map((call) => call.map((value) => String(value)).join(' '))
      .filter(
        (value) =>
          value.includes('DCA allowance is lower than configured spend') ||
          value.includes('DCA simulation reverted with allowance error')
      );

    expect(allowanceWarnings).toHaveLength(1);
    expect(allowanceWarnings[0]).toContain('spender=0x8888888888888888888888888888888888888888');

    warnSpy.mockRestore();
  });

  it('logs a balance-specific warning once when DCA simulation fails due to insufficient balance', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    dcaResolveRouteMock.mockResolvedValue({
      targetProtocolAddress: '0xf992efcb5fa2ed7cb48310d9dd8cb4ce5fb7ddc9',
      callData: '0x12345678',
      minSwapAssetOutBaseUnits: 49500000n,
      spenderAddress: '0xc06ebbefd94032b85424d51906e2a335efae264b',
    });

    findByStatusMock.mockResolvedValue([
      makeActiveRecipe({
        id: 'dca-balance-low',
        recipeType: RecipeType.RECURRING_DCA,
        swapProvider: 'ARC_APP_KIT_SWAP',
        parametersJson: { totalBudgetUsdc: '100', perExecutionAmountUsdc: '5', mode: 'PULL', maxSlippageBps: 100, targetAssetSymbol: 'EURC' },
      }),
    ]);

    readContractMock.mockImplementation(async (request: Record<string, unknown>) => {
      const functionName = request.functionName as string;
      if (functionName === 'balanceOf') {
        return 5000000n;
      }

      if (functionName === 'allowance') {
        return 5000000n;
      }

      return true;
    });

    simulateRecipeStepMock.mockResolvedValue({
      success: false,
      errorMessage: 'execution reverted: ERC20: transfer amount exceeds balance',
    });

    await pollAndTriggerActiveRecipes();
    await pollAndTriggerActiveRecipes();

    expect(queueAddMock).not.toHaveBeenCalled();

    const balanceWarnings = warnSpy.mock.calls
      .flatMap((call) => call)
      .filter(
        (value) =>
          typeof value === 'string' &&
          value.includes('DCA simulation failed because an ERC20 balance was insufficient')
      ) as string[];

    expect(balanceWarnings).toHaveLength(1);
    expect(balanceWarnings[0]).toContain('targetProtocol=0xf992efcb5fa2ed7cb48310d9dd8cb4ce5fb7ddc9');
    expect(balanceWarnings[0]).toContain('selector=0x12345678');

    warnSpy.mockRestore();
  });

  it('skips simulation when DCA allowance precheck is below required spend', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    dcaResolveRouteMock.mockResolvedValue({
      targetProtocolAddress: '0x9999999999999999999999999999999999999999',
      callData: '0xabcdef12',
      minSwapAssetOutBaseUnits: 4950000n,
      spenderAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });

    readContractMock.mockImplementation(async (request: Record<string, unknown>) => {
      const functionName = request.functionName as string;
      if (functionName === 'balanceOf') {
        return 5000000n;
      }

      if (functionName === 'allowance') {
        const args = request.args as unknown[];
        const spender = String(args[1] || '').toLowerCase();
        if (spender === '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') {
          return 1000000n;
        }
        return 5000000n;
      }

      return true;
    });

    findByStatusMock.mockResolvedValue([
      makeActiveRecipe({
        id: 'dca-precheck-low-allowance',
        recipeType: RecipeType.RECURRING_DCA,
        swapProvider: 'ARC_APP_KIT_SWAP',
        parametersJson: { totalBudgetUsdc: '100', perExecutionAmountUsdc: '5', mode: 'PULL', maxSlippageBps: 100, targetAssetSymbol: 'EURC' },
      }),
    ]);

    await pollAndTriggerActiveRecipes();
    await pollAndTriggerActiveRecipes();

    expect(simulateRecipeStepMock).not.toHaveBeenCalled();
    expect(queueAddMock).not.toHaveBeenCalled();

    const allowanceWarnings = warnSpy.mock.calls
      .flatMap((call) => call)
      .filter(
        (value) =>
          typeof value === 'string' &&
          value.includes('DCA allowance is lower than configured spend')
      ) as string[];

    expect(allowanceWarnings).toHaveLength(1);
    expect(allowanceWarnings[0]).toContain('spender=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(allowanceWarnings[0]).toContain('currentAllowanceBaseUnits=1000000');
    expect(allowanceWarnings[0]).toContain('requiredBaseUnits=5000000');

    warnSpy.mockRestore();
  });

  it('treats inferred calldata spender as advisory when shared proxy allowance is sufficient', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    dcaResolveRouteMock.mockResolvedValue({
      targetProtocolAddress: '0xf992efcb5fa2ed7cb48310d9dd8cb4ce5fb7ddc9',
      callData:
        '0x7ebc46f0' +
        '0000000000000000000000003600000000000000000000000000000000000000' +
        '000000000000000000000000c06ebbefd94032b85424d51906e2a335efae264b' +
        '00000000000000000000000000000000000000000000000000000000000003e8',
      minSwapAssetOutBaseUnits: 4950000n,
    });

    readContractMock.mockImplementation(async (request: Record<string, unknown>) => {
      const functionName = request.functionName as string;

      if (functionName === 'balanceOf') {
        return 5000000n;
      }

      if (functionName === 'allowance') {
        const args = request.args as unknown[];
        const spender = String(args[1] || '').toLowerCase();

        if (spender === '0xc06ebbefd94032b85424d51906e2a335efae264b') {
          return 1000000n;
        }

        return 5000000n;
      }

      return true;
    });

    findByStatusMock.mockResolvedValue([
      makeActiveRecipe({
        id: 'dca-embedded-spender',
        recipeType: RecipeType.RECURRING_DCA,
        swapProvider: 'ARC_APP_KIT_SWAP',
        parametersJson: { totalBudgetUsdc: '100', perExecutionAmountUsdc: '5', mode: 'PULL', maxSlippageBps: 100, targetAssetSymbol: 'EURC' },
      }),
    ]);

    await pollAndTriggerActiveRecipes();

    expect(simulateRecipeStepMock).toHaveBeenCalledTimes(1);
    expect(queueAddMock).toHaveBeenCalledTimes(1);

    const blockingWarnings = warnSpy.mock.calls
      .flatMap((call) => call)
      .filter(
        (value) =>
          typeof value === 'string' &&
          value.includes('DCA allowance is lower than configured spend')
      );

    expect(blockingWarnings).toHaveLength(0);

    const advisoryWarnings = warnSpy.mock.calls
      .flatMap((call) => call)
      .filter(
        (value) =>
          typeof value === 'string' &&
          value.includes('DCA advisory spender allowance is below perExecution spend')
      ) as string[];

    expect(advisoryWarnings).toHaveLength(1);
    expect(advisoryWarnings[0]).toContain('spender=0xc06ebbefd94032b85424d51906e2a335efae264b');

    warnSpy.mockRestore();
  });

  it('decodes DCA swap ABI parameters to expose candidate addresses from calldata', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const encodedCallData = encodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'swapExactTokensForTokens',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'amountIn', type: 'uint256' },
            { name: 'amountOutMin', type: 'uint256' },
            { name: 'path', type: 'address[]' },
            { name: 'to', type: 'address' },
            { name: 'deadline', type: 'uint256' },
          ],
          outputs: [{ name: '', type: 'uint256[]' }],
        },
      ],
      functionName: 'swapExactTokensForTokens',
      args: [
        5_000_000n,
        4_950_000n,
        ['0x3600000000000000000000000000000000000000', '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF'],
        '0x1111111111111111111111111111111111111111',
        1_700_000_000_000n,
      ],
    });

    dcaResolveRouteMock.mockResolvedValue({
      targetProtocolAddress: '0xf992efcb5fa2ed7cb48310d9dd8cb4ce5fb7ddc9',
      callData: encodedCallData,
      minSwapAssetOutBaseUnits: 4950000n,
    });

    readContractMock
      .mockResolvedValueOnce(5000000n) // USDC balance precheck
      .mockResolvedValueOnce(5000000n) // USDC allowance precheck (runtime spender)
      .mockResolvedValueOnce(5000000n); // USDC allowance precheck (shared executor)

    findByStatusMock.mockResolvedValue([
      makeActiveRecipe({
        id: 'dca-abi-decoded-addresses',
        recipeType: RecipeType.RECURRING_DCA,
        swapProvider: 'ARC_APP_KIT_SWAP',
        parametersJson: { totalBudgetUsdc: '100', perExecutionAmountUsdc: '5', mode: 'PULL', maxSlippageBps: 100, targetAssetSymbol: 'EURC' },
      }),
    ]);

    await pollAndTriggerActiveRecipes();

    const logs = logSpy.mock.calls.flatMap((call) => call.map((value) => String(value))).join('\n');
    expect(logs).toContain('decodedAbiAddresses=');
    expect(logs).toContain('0x3600000000000000000000000000000000000000');
    expect(logs).toContain('0xf0c4a4ce82a5746abaad9425360ab04fbba432bf');

    logSpy.mockRestore();
  });

  it('continues enqueue when route omits spenderAddress and only inferred spender is below threshold', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    dcaResolveRouteMock.mockResolvedValue({
      targetProtocolAddress: '0xf992efcb5fa2ed7cb48310d9dd8cb4ce5fb7ddc9',
      callData:
        '0x7ebc46f0' +
        '0000000000000000000000003600000000000000000000000000000000000000' +
        '000000000000000000000000c06ebbefd94032b85424d51906e2a335efae264b' +
        '00000000000000000000000000000000000000000000000000000000000003e8',
      minSwapAssetOutBaseUnits: 4950000n,
    });

    readContractMock.mockImplementation(async (request: Record<string, unknown>) => {
      const functionName = request.functionName as string;

      if (functionName === 'balanceOf') {
        return 5000000n;
      }

      if (functionName === 'allowance') {
        const args = request.args as unknown[];
        const spender = String(args[1] || '').toLowerCase();

        if (spender === '0xc06ebbefd94032b85424d51906e2a335efae264b') {
          return 1000000n;
        }

        return 5000000n;
      }

      return true;
    });

    findByStatusMock.mockResolvedValue([
      makeActiveRecipe({
        id: 'dca-inferred-spender-low-allowance',
        recipeType: RecipeType.RECURRING_DCA,
        swapProvider: 'ARC_APP_KIT_SWAP',
        parametersJson: { totalBudgetUsdc: '100', perExecutionAmountUsdc: '5', mode: 'PULL', maxSlippageBps: 100, targetAssetSymbol: 'EURC' },
      }),
    ]);

    await pollAndTriggerActiveRecipes();

    expect(simulateRecipeStepMock).toHaveBeenCalledTimes(1);
    expect(queueAddMock).toHaveBeenCalledTimes(1);

    const blockingWarnings = warnSpy.mock.calls
      .flatMap((call) => call)
      .filter(
        (value) =>
          typeof value === 'string' &&
          value.includes('DCA allowance is lower than configured spend')
      );

    expect(blockingWarnings).toHaveLength(0);

    const advisoryWarnings = warnSpy.mock.calls
      .flatMap((call) => call)
      .filter(
        (value) =>
          typeof value === 'string' &&
          value.includes('DCA advisory spender allowance is below perExecution spend')
      ) as string[];

    expect(advisoryWarnings).toHaveLength(1);
    expect(advisoryWarnings[0]).toContain('spender=0xc06ebbefd94032b85424d51906e2a335efae264b');

    warnSpy.mockRestore();
  });

  it('does not block enqueue when only advisory spender allowance is insufficient', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    dcaResolveRouteMock.mockResolvedValue({
      targetProtocolAddress: '0xf992efcb5fa2ed7cb48310d9dd8cb4ce5fb7ddc9',
      callData:
        '0x7ebc46f0' +
        '0000000000000000000000003600000000000000000000000000000000000000' +
        '000000000000000000000000c06ebbefd94032b85424d51906e2a335efae264b' +
        '00000000000000000000000000000000000000000000000000000000000003e8',
      minSwapAssetOutBaseUnits: 4950000n,
    });

    readContractMock.mockImplementation(async (request: Record<string, unknown>) => {
      const functionName = request.functionName as string;

      if (functionName === 'balanceOf') {
        return 5000000n;
      }

      if (functionName === 'allowance') {
        const args = request.args as unknown[];
        const spender = String(args[1] || '').toLowerCase();

        // Runtime spender (decoded from calldata) remains sufficient.
        if (spender === '0xc06ebbefd94032b85424d51906e2a335efae264b') {
          return 5000000n;
        }

        // Simulate an advisory candidate spender with zero allowance.
        if (spender === '0xf992efcb5fa2ed7cb48310d9dd8cb4ce5fb7ddc9') {
          return 0n;
        }

        return 5000000n;
      }

      return true;
    });

    findByStatusMock.mockResolvedValue([
      makeActiveRecipe({
        id: 'dca-advisory-spender-low-allowance',
        recipeType: RecipeType.RECURRING_DCA,
        swapProvider: 'ARC_APP_KIT_SWAP',
        parametersJson: {
          totalBudgetUsdc: '100',
          perExecutionAmountUsdc: '5',
          mode: 'PULL',
          maxSlippageBps: 100,
          targetAssetSymbol: 'EURC',
        },
      }),
    ]);

    await pollAndTriggerActiveRecipes();

    expect(simulateRecipeStepMock).toHaveBeenCalledTimes(1);
    expect(queueAddMock).toHaveBeenCalledTimes(1);

    const blockingWarnings = warnSpy.mock.calls
      .flatMap((call) => call)
      .filter(
        (value) =>
          typeof value === 'string' &&
          value.includes('DCA allowance is lower than configured spend')
      );

    expect(blockingWarnings).toHaveLength(0);

    const advisoryWarnings = warnSpy.mock.calls
      .flatMap((call) => call)
      .filter(
        (value) =>
          typeof value === 'string' &&
          value.includes('DCA advisory spender allowance is below perExecution spend')
      ) as string[];

    expect(advisoryWarnings).toHaveLength(1);
    expect(advisoryWarnings[0]).toContain('spender=0xf992efcb5fa2ed7cb48310d9dd8cb4ce5fb7ddc9');

    warnSpy.mockRestore();
  });
});
