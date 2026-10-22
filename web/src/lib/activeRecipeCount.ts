interface RecipeSummary {
  id: string;
  userAddress: string;
  status: string;
  delegationValidUntil?: string | null;
}

interface RecipesResponse {
  success?: boolean;
  dataSource?: string;
  recipes?: RecipeSummary[];
  error?: string;
}

const RECIPE_FETCH_LIMIT = 200;

export function countActiveRecipes(recipes: RecipeSummary[], userAddress: string, nowMs = Date.now()): number {
  const wallet = userAddress.toLowerCase();
  const activeIds = new Set<string>();

  for (const recipe of recipes) {
    if (
      recipe.userAddress.toLowerCase() === wallet &&
      recipe.status === 'ACTIVE' &&
      recipe.delegationValidUntil &&
      Date.parse(recipe.delegationValidUntil) > nowMs
    ) {
      activeIds.add(recipe.id);
    }
  }

  return activeIds.size;
}

export async function fetchActiveRecipeCount(userAddress: string, signal?: AbortSignal): Promise<number> {
  const params = new URLSearchParams({
    userAddress: userAddress.toLowerCase(),
    limit: String(RECIPE_FETCH_LIMIT),
  });
  const response = await fetch(`/api/recipes?${params.toString()}`, { cache: 'no-store', signal });
  const payload = await response.json() as RecipesResponse | null;

  if (!response.ok || !payload?.success || !Array.isArray(payload.recipes)) {
    throw new Error(payload?.error || `Failed to load active recipes (${response.status}).`);
  }
  if (payload.dataSource !== 'keeper-db') {
    throw new Error('Active recipes are unavailable: keeper data could not be loaded.');
  }
  // The list API caps results without pagination; never present a truncated list as a total.
  if (payload.recipes.length >= RECIPE_FETCH_LIMIT) {
    throw new Error('Active recipe count is unavailable because the recipe list limit was reached.');
  }

  return countActiveRecipes(payload.recipes, userAddress);
}
