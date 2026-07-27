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
    recipeName: 'USDC Recurring DCA',
    targetProtocol: 'Arc Official DEX Router',
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
    const body = await request.json();
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
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
}
