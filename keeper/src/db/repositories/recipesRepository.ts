import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { query, transaction } from '../client';
import { ActiveRecipeRecord, JsonObject, RecipeStatus, RecipeType, SwapProvider } from '../types';

interface ActiveRecipeRow {
  id: string;
  userAddress: string;
  recipeType: RecipeType;
  status: RecipeStatus;
  targetProtocol: string | null;
  swapProvider: SwapProvider | null;
  parametersJson: JsonObject;
  lastExecutedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function mapRecipeRow(row: ActiveRecipeRow): ActiveRecipeRecord {
  return {
    id: row.id,
    userAddress: row.userAddress,
    recipeType: row.recipeType,
    status: row.status,
    targetProtocol: row.targetProtocol,
    swapProvider: row.swapProvider,
    parametersJson: row.parametersJson,
    lastExecutedAt: row.lastExecutedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

interface RegisterRecipeInput {
  userAddress: string;
  recipeType: RecipeType;
  targetProtocol: string | null;
  swapProvider: SwapProvider | null;
  parametersJson: JsonObject;
}

interface UpdateRecipeInput {
  status: RecipeStatus;
  targetProtocol: string | null;
  swapProvider: SwapProvider | null;
  parametersJson: JsonObject;
}

export const recipesRepository = {
  async findMatchingForRegistration(input: {
    userAddress: string;
    recipeType: RecipeType;
    targetProtocol: string | null;
    swapProvider: SwapProvider | null;
  }): Promise<ActiveRecipeRecord | null> {
    const rows = await query<ActiveRecipeRow>({
      name: 'recipe-find-matching-registration',
      text: `
        SELECT
          id,
          "userAddress",
          "recipeType",
          status,
          "targetProtocol",
          "swapProvider",
          "parametersJson",
          "lastExecutedAt",
          "createdAt",
          "updatedAt"
        FROM "ActiveRecipe"
        WHERE "userAddress" = $1
          AND "recipeType" = $2::"RecipeType"
          AND ($3::text IS NULL OR "targetProtocol" = $3)
          AND ($4::"SwapProvider" IS NULL OR "swapProvider" = $4)
        ORDER BY "createdAt" DESC
        LIMIT 1
      `,
      values: [input.userAddress, input.recipeType, input.targetProtocol, input.swapProvider],
    });

    if (rows.length === 0) {
      return null;
    }

    return mapRecipeRow(rows[0]);
  },

  async updateForActivation(recipeId: string, input: UpdateRecipeInput): Promise<ActiveRecipeRecord> {
    const now = new Date();
    const rows = await query<ActiveRecipeRow>({
      name: 'recipe-update-for-activation',
      text: `
        UPDATE "ActiveRecipe"
        SET
          status = $2::"RecipeStatus",
          "parametersJson" = $3::jsonb,
          "targetProtocol" = CASE WHEN $4::boolean THEN $5::text ELSE "targetProtocol" END,
          "swapProvider" = CASE WHEN $6::boolean THEN $7::"SwapProvider" ELSE "swapProvider" END,
          "updatedAt" = $8
        WHERE id = $1
        RETURNING
          id,
          "userAddress",
          "recipeType",
          status,
          "targetProtocol",
          "swapProvider",
          "parametersJson",
          "lastExecutedAt",
          "createdAt",
          "updatedAt"
      `,
      values: [
        recipeId,
        input.status,
        JSON.stringify(input.parametersJson),
        input.targetProtocol !== null,
        input.targetProtocol,
        input.swapProvider !== null,
        input.swapProvider,
        now,
      ],
    });

    if (rows.length === 0) {
      throw new Error('No matching recipe found to update status.');
    }

    return mapRecipeRow(rows[0]);
  },

  async createWithUserConnectOrCreate(input: RegisterRecipeInput): Promise<ActiveRecipeRecord> {
    return transaction(async (client) => {
      await insertUserIfMissing(client, input.userAddress);
      return insertActiveRecipe(client, input);
    });
  },

  async findLatestByUserAndType(userAddress: string, recipeType: RecipeType): Promise<ActiveRecipeRecord | null> {
    const rows = await query<ActiveRecipeRow>({
      name: 'recipe-find-latest-user-type',
      text: `
        SELECT
          id,
          "userAddress",
          "recipeType",
          status,
          "targetProtocol",
          "swapProvider",
          "parametersJson",
          "lastExecutedAt",
          "createdAt",
          "updatedAt"
        FROM "ActiveRecipe"
        WHERE "userAddress" = $1
          AND "recipeType" = $2::"RecipeType"
        ORDER BY "updatedAt" DESC
        LIMIT 1
      `,
      values: [userAddress, recipeType],
    });

    return rows[0] ? mapRecipeRow(rows[0]) : null;
  },

  async updateStatus(recipeId: string, status: RecipeStatus): Promise<ActiveRecipeRecord> {
    const now = new Date();
    const rows = await query<ActiveRecipeRow>({
      name: 'recipe-update-status',
      text: `
        UPDATE "ActiveRecipe"
        SET status = $2::"RecipeStatus", "updatedAt" = $3
        WHERE id = $1
        RETURNING
          id,
          "userAddress",
          "recipeType",
          status,
          "targetProtocol",
          "swapProvider",
          "parametersJson",
          "lastExecutedAt",
          "createdAt",
          "updatedAt"
      `,
      values: [recipeId, status, now],
    });

    if (rows.length === 0) {
      throw new Error('No matching recipe found to update status.');
    }

    return mapRecipeRow(rows[0]);
  },

  async findByStatus(status: RecipeStatus): Promise<ActiveRecipeRecord[]> {
    const rows = await query<ActiveRecipeRow>({
      name: 'recipe-find-by-status',
      text: `
        SELECT
          id,
          "userAddress",
          "recipeType",
          status,
          "targetProtocol",
          "swapProvider",
          "parametersJson",
          "lastExecutedAt",
          "createdAt",
          "updatedAt"
        FROM "ActiveRecipe"
        WHERE status = $1::"RecipeStatus"
      `,
      values: [status],
    });

    return rows.map(mapRecipeRow);
  },

  async findById(recipeId: string): Promise<ActiveRecipeRecord | null> {
    const rows = await query<ActiveRecipeRow>({
      name: 'recipe-find-by-id',
      text: `
        SELECT
          id,
          "userAddress",
          "recipeType",
          status,
          "targetProtocol",
          "swapProvider",
          "parametersJson",
          "lastExecutedAt",
          "createdAt",
          "updatedAt"
        FROM "ActiveRecipe"
        WHERE id = $1
        LIMIT 1
      `,
      values: [recipeId],
    });

    return rows[0] ? mapRecipeRow(rows[0]) : null;
  },

  async updateLastExecutedAt(recipeId: string, executedAt: Date): Promise<void> {
    await query({
      name: 'recipe-update-last-executed-at',
      text: `
        UPDATE "ActiveRecipe"
        SET "lastExecutedAt" = $2, "updatedAt" = $3
        WHERE id = $1
      `,
      values: [recipeId, executedAt, executedAt],
    });
  },
};

async function insertUserIfMissing(client: PoolClient, userAddress: string): Promise<void> {
  const now = new Date();
  await client.query({
    name: 'user-insert-if-missing',
    text: `
      INSERT INTO "User" (id, "walletAddress", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4)
      ON CONFLICT ("walletAddress") DO NOTHING
    `,
    values: [randomUUID(), userAddress, now, now],
  });
}

async function insertActiveRecipe(client: PoolClient, input: RegisterRecipeInput): Promise<ActiveRecipeRecord> {
  const now = new Date();
  const result = await client.query<ActiveRecipeRow>({
    name: 'recipe-insert-active',
    text: `
      INSERT INTO "ActiveRecipe" (
        id,
        "userAddress",
        "recipeType",
        status,
        "targetProtocol",
        "swapProvider",
        "parametersJson",
        "createdAt",
        "updatedAt"
      ) VALUES (
        $1,
        $2,
        $3::"RecipeType",
        $4::"RecipeStatus",
        $5,
        $6::"SwapProvider",
        $7::jsonb,
        $8,
        $9
      )
      RETURNING
        id,
        "userAddress",
        "recipeType",
        status,
        "targetProtocol",
        "swapProvider",
        "parametersJson",
        "lastExecutedAt",
        "createdAt",
        "updatedAt"
    `,
    values: [
      randomUUID(),
      input.userAddress,
      input.recipeType,
      RecipeStatus.ACTIVE,
      input.targetProtocol,
      input.swapProvider,
      JSON.stringify(input.parametersJson),
      now,
      now,
    ],
  });

  return mapRecipeRow(result.rows[0]);
}
