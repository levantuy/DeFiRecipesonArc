import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface ActiveRecipeItem {
  id: string;
  userAddress: string;
  recipeType: string;
  recipeName: string;
  targetProtocol: string;
  maxSlippageBps: number;
  maxUsdcSpendLimit: string;
  status: string;
  createdAt: string;
}

interface CreateRecipePayload {
  action?: string;
  userAddress?: string;
  recipeType?: string;
  recipeName?: string;
  targetProtocol?: string;
  targetProtocolAddress?: string;
  swapProvider?: string;
  maxSlippageBps?: number;
  maxUsdcSpendLimit?: string;
  status?: string;
  parametersJson?: Record<string, unknown>;
}

interface KeeperRuntimeConfigApiPayload {
  action?: string;
}

const DEFAULT_KEEPER_API_BASE_URL = 'http://localhost:8787';
const DEFAULT_DCA_MAX_SLIPPAGE_BPS = 100;
const MIN_DCA_SLIPPAGE_BPS = 10;
const MAX_DCA_SLIPPAGE_BPS = 1000;

type DcaExecutionMode = 'PREFUND' | 'PULL';

function getKeeperApiBaseUrl() {
  const configured = process.env.KEEPER_API_BASE_URL || process.env.NEXT_PUBLIC_KEEPER_API_BASE_URL;
  return (configured || DEFAULT_KEEPER_API_BASE_URL).trim().replace(/\/$/, '');
}

async function postToKeeper(path: string, payload: Record<string, unknown>) {
  const response = await fetch(`${getKeeperApiBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });

  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !data) {
    const errorText =
      data && typeof data.error === 'string'
        ? data.error
        : `Keeper sync failed with status ${response.status}.`;
    throw new Error(errorText);
  }

  return data;
}

function normalizeMaxSlippageBps(rawValue: unknown): number {
  if (typeof rawValue !== 'number' || !Number.isInteger(rawValue)) {
    return DEFAULT_DCA_MAX_SLIPPAGE_BPS;
  }

  if (rawValue < MIN_DCA_SLIPPAGE_BPS || rawValue > MAX_DCA_SLIPPAGE_BPS) {
    throw new Error(
      `maxSlippageBps must be between ${MIN_DCA_SLIPPAGE_BPS} and ${MAX_DCA_SLIPPAGE_BPS}.`
    );
  }

  return rawValue;
}

function normalizeDcaUsdcAmount(rawValue: unknown, fieldName: string): string {
  if (typeof rawValue !== 'string') {
    throw new Error(`${fieldName} must be a string.`);
  }

  const normalized = rawValue.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(normalized)) {
    throw new Error(`${fieldName} must be numeric with up to 6 decimals.`);
  }

  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`${fieldName} must be greater than 0.`);
  }

  return normalized;
}

function normalizeDcaExecutionMode(rawValue: unknown): DcaExecutionMode {
  if (rawValue === 'PREFUND') {
    throw new Error(
      'DCA mode PREFUND is not supported by the current keeper execution path. Use mode PULL.'
    );
  }
  return 'PULL';
}

// In-memory active recipe storage for Web UI (syncs with keeper DB if available)
const inMemoryRecipes: ActiveRecipeItem[] = [
  {
    id: 'recipe-auto-compounder-1',
    userAddress: '0x3600...0001',
    recipeType: 'AUTO_COMPOUNDER',
    recipeName: 'USDC Yield Auto-Compounder',
    targetProtocol: 'Arc Lending Protocol',
    maxSlippageBps: 50,
    maxUsdcSpendLimit: '1000',
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'recipe-recurring-dca-1',
    userAddress: '0x3600...0001',
    recipeType: 'RECURRING_DCA',
    recipeName: 'USDC -> EURC Recurring DCA',
    targetProtocol: 'Arc App Kit Swap API',
    maxSlippageBps: 100,
    maxUsdcSpendLimit: '500',
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
  },
];

export async function GET() {
  return NextResponse.json({ success: true, recipes: inMemoryRecipes });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateRecipePayload | KeeperRuntimeConfigApiPayload;

    if (body.action === 'keeperRuntimeConfig') {
      const healthResponse = await fetch(`${getKeeperApiBaseUrl()}/healthz`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      });

      const healthData = (await healthResponse.json().catch(() => null)) as Record<string, unknown> | null;
      if (!healthResponse.ok || !healthData) {
        return NextResponse.json(
          {
            success: false,
            error: `Failed to fetch keeper runtime config (status ${healthResponse.status}).`,
          },
          { status: 502 }
        );
      }

      return NextResponse.json({
        success: true,
        runtime: {
          keeperAddress:
            typeof healthData.keeperAddress === 'string' ? healthData.keeperAddress : null,
          chainId:
            typeof healthData.chainId === 'number' ? healthData.chainId : null,
          contracts:
            typeof healthData.contracts === 'object' && healthData.contracts !== null
              ? healthData.contracts
              : null,
          timestamp:
            typeof healthData.timestamp === 'string' ? healthData.timestamp : null,
        },
      });
    }

    if (body.action === 'allowancePrecheck') {
      if (!body.userAddress || body.recipeType !== 'RECURRING_DCA') {
        return NextResponse.json(
          { success: false, error: 'allowancePrecheck requires userAddress and recipeType=RECURRING_DCA.' },
          { status: 400 }
        );
      }

      const requestParameters =
        body.parametersJson && typeof body.parametersJson === 'object'
          ? { ...(body.parametersJson as Record<string, unknown>) }
          : {};

      const requestedTotalBudget = requestParameters.totalBudgetUsdc;
      const requestedPerExecution = requestParameters.perExecutionAmountUsdc;
      const requestedMode = requestParameters.mode;
      if (requestedTotalBudget === undefined || requestedPerExecution === undefined) {
        throw new Error('allowancePrecheck requires totalBudgetUsdc and perExecutionAmountUsdc in parametersJson.');
      }

      const totalBudgetUsdc = normalizeDcaUsdcAmount(requestedTotalBudget, 'totalBudgetUsdc');
      const perExecutionAmountUsdc = normalizeDcaUsdcAmount(requestedPerExecution, 'perExecutionAmountUsdc');
      if (Number(perExecutionAmountUsdc) > Number(totalBudgetUsdc)) {
        throw new Error('perExecutionAmountUsdc must be less than or equal to totalBudgetUsdc.');
      }

      const mode = normalizeDcaExecutionMode(requestedMode);
      const requestedSlippage = body.maxSlippageBps ?? requestParameters.maxSlippageBps;
      const maxSlippageBps = normalizeMaxSlippageBps(requestedSlippage);

      const keeperResult = await postToKeeper('/recipes/dca/allowance-precheck', {
        userAddress: body.userAddress,
        totalBudgetUsdc,
        perExecutionAmountUsdc,
        maxSlippageBps,
        mode,
        targetAssetSymbol: requestParameters.targetAssetSymbol,
      });

      return NextResponse.json({ success: true, allowance: keeperResult.allowance ?? null });
    }

    if (body.action === 'register') {
      if (!body.userAddress || !body.recipeType) {
        return NextResponse.json(
          { success: false, error: 'userAddress and recipeType are required for register action.' },
          { status: 400 }
        );
      }

      const requestParameters =
        body.parametersJson && typeof body.parametersJson === 'object'
          ? { ...(body.parametersJson as Record<string, unknown>) }
          : {};
      const requestedSlippage = body.maxSlippageBps ?? requestParameters.maxSlippageBps;
      const maxSlippageBps = normalizeMaxSlippageBps(requestedSlippage);
      requestParameters.maxSlippageBps = maxSlippageBps;

      if (body.recipeType === 'RECURRING_DCA') {
        const requestedTotalBudget = requestParameters.totalBudgetUsdc;
        const requestedPerExecution = requestParameters.perExecutionAmountUsdc;
        const requestedMode = requestParameters.mode;

        if (requestedTotalBudget === undefined || requestedPerExecution === undefined) {
          throw new Error('RECURRING_DCA requires totalBudgetUsdc and perExecutionAmountUsdc.');
        }

        const totalBudgetUsdc = normalizeDcaUsdcAmount(requestedTotalBudget, 'totalBudgetUsdc');
        const perExecutionAmountUsdc = normalizeDcaUsdcAmount(requestedPerExecution, 'perExecutionAmountUsdc');

        if (Number(perExecutionAmountUsdc) > Number(totalBudgetUsdc)) {
          throw new Error('perExecutionAmountUsdc must be less than or equal to totalBudgetUsdc.');
        }

        requestParameters.totalBudgetUsdc = totalBudgetUsdc;
        requestParameters.perExecutionAmountUsdc = perExecutionAmountUsdc;
        requestParameters.mode = normalizeDcaExecutionMode(requestedMode);

        // Backward-compatible aliases still consumed by current scheduler code paths.
        requestParameters.dcaAmountUsdc = perExecutionAmountUsdc;
      }

      const keeperPayload: Record<string, unknown> = {
        userAddress: body.userAddress,
        recipeType: body.recipeType,
        parametersJson: requestParameters,
      };

      if (body.targetProtocolAddress) {
        keeperPayload.targetProtocol = body.targetProtocolAddress;
      }

      if (body.swapProvider) {
        keeperPayload.swapProvider = body.swapProvider;
      }

      const keeperResult = await postToKeeper('/recipes/register', keeperPayload);

      const newRecipe: ActiveRecipeItem = {
        id: `recipe-${Date.now()}`,
        userAddress: body.userAddress,
        recipeType: body.recipeType,
        recipeName: body.recipeName || 'Custom Recipe',
        targetProtocol: body.targetProtocol || body.swapProvider || body.targetProtocolAddress || 'Arc Protocol',
        maxSlippageBps,
        maxUsdcSpendLimit: body.maxUsdcSpendLimit || '1000',
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
      };
      inMemoryRecipes.unshift(newRecipe);

      return NextResponse.json({ success: true, recipe: newRecipe, keeper: keeperResult });
    }

    if (body.action === 'status') {
      if (!body.userAddress || !body.recipeType || !body.status) {
        return NextResponse.json(
          { success: false, error: 'userAddress, recipeType, and status are required for status action.' },
          { status: 400 }
        );
      }

      const keeperResult = await postToKeeper('/recipes/status', {
        userAddress: body.userAddress,
        recipeType: body.recipeType,
        status: body.status,
      });

      for (const recipe of inMemoryRecipes) {
        if (recipe.userAddress === body.userAddress && recipe.recipeType === body.recipeType) {
          recipe.status = body.status;
        }
      }

      return NextResponse.json({ success: true, keeper: keeperResult });
    }

    const newRecipe: ActiveRecipeItem = {
      id: `recipe-${Date.now()}`,
      userAddress: body.userAddress || '0xUserAddress',
      recipeType: body.recipeType || 'AUTO_COMPOUNDER',
      recipeName: body.recipeName || 'Custom Recipe',
      targetProtocol: body.targetProtocol || 'Arc Protocol',
      maxSlippageBps: body.maxSlippageBps || 50,
      maxUsdcSpendLimit: body.maxUsdcSpendLimit || '1000',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    };
    inMemoryRecipes.unshift(newRecipe);
    return NextResponse.json({ success: true, recipe: newRecipe });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Invalid request payload';
    return NextResponse.json({ success: false, error: errorMessage }, { status: 400 });
  }
}
