import { NextResponse } from 'next/server';

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

const DEFAULT_KEEPER_API_BASE_URL = 'http://localhost:8787';
const DEFAULT_DCA_MAX_SLIPPAGE_BPS = 100;
const MIN_DCA_SLIPPAGE_BPS = 10;
const MAX_DCA_SLIPPAGE_BPS = 1000;

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
    recipeName: 'USDC -> cirBTC Recurring DCA',
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
    const body = (await request.json()) as CreateRecipePayload;

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
