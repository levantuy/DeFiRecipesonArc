import { Prisma, PrismaClient, RecipeStatus, RecipeType } from '@prisma/client';
import type { Address } from 'viem';
import { publicClient } from '../simulation/staticSimulationEngine';

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const RECIPE_TYPE_SET = new Set(Object.values(RecipeType));
const RECIPE_STATUS_SET = new Set(Object.values(RecipeStatus));

interface RegisterRecipePayload {
  userAddress?: unknown;
  recipeType?: unknown;
  targetProtocol?: unknown;
  parametersJson?: unknown;
}

interface UpdateRecipeStatusPayload {
  userAddress?: unknown;
  recipeType?: unknown;
  status?: unknown;
}

interface ListExecutionLogsPayload {
  userAddress?: unknown;
  limit?: unknown;
}

function recipeLogContext(params: { userAddress: string; recipeType: RecipeType; recipeId?: string }): string {
  const recipeIdPart = params.recipeId ? ` recipeId=${params.recipeId}` : '';
  return `[userAddress=${params.userAddress} recipeType=${params.recipeType}${recipeIdPart}]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function normalizeAddress(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !ADDRESS_REGEX.test(value)) {
    throw new Error(`${fieldName} must be a valid 20-byte hex address.`);
  }
  return value.toLowerCase();
}

function parseRecipeType(value: unknown): RecipeType {
  if (typeof value !== 'string' || !RECIPE_TYPE_SET.has(value as RecipeType)) {
    throw new Error(`recipeType must be one of: ${Object.values(RecipeType).join(', ')}`);
  }
  return value as RecipeType;
}

function parseRecipeStatus(value: unknown): RecipeStatus {
  if (typeof value !== 'string' || !RECIPE_STATUS_SET.has(value as RecipeStatus)) {
    throw new Error(`status must be one of: ${Object.values(RecipeStatus).join(', ')}`);
  }
  return value as RecipeStatus;
}

function parseRegisterPayload(rawBody: unknown): {
  userAddress: string;
  recipeType: RecipeType;
  targetProtocol: string;
  parametersJson: Prisma.InputJsonValue;
} {
  if (!isRecord(rawBody)) {
    throw new Error('Request body must be a JSON object.');
  }

  const body = rawBody as RegisterRecipePayload;
  const userAddress = normalizeAddress(body.userAddress, 'userAddress');
  const recipeType = parseRecipeType(body.recipeType);
  const targetProtocol = normalizeAddress(body.targetProtocol, 'targetProtocol');

  let parametersJson: Prisma.InputJsonValue = {};
  if (body.parametersJson !== undefined) {
    if (!isRecord(body.parametersJson)) {
      throw new Error('parametersJson must be a JSON object when provided.');
    }
    parametersJson = toInputJsonValue(body.parametersJson);
  }

  return {
    userAddress,
    recipeType,
    targetProtocol,
    parametersJson,
  };
}

async function assertTargetProtocolHasCode(targetProtocol: string): Promise<void> {
  const bytecode = await publicClient.getBytecode({
    address: targetProtocol as Address,
  });

  if (!bytecode || bytecode === '0x') {
    throw new Error(
      `targetProtocol ${targetProtocol} has no deployed contract bytecode on Arc Testnet. ` +
      `Use a deployed protocol contract address.`
    );
  }
}

function parseStatusPayload(rawBody: unknown): {
  userAddress: string;
  recipeType: RecipeType;
  status: RecipeStatus;
} {
  if (!isRecord(rawBody)) {
    throw new Error('Request body must be a JSON object.');
  }

  const body = rawBody as UpdateRecipeStatusPayload;
  return {
    userAddress: normalizeAddress(body.userAddress, 'userAddress'),
    recipeType: parseRecipeType(body.recipeType),
    status: parseRecipeStatus(body.status),
  };
}

export async function registerOrActivateRecipe(
  prisma: PrismaClient,
  rawBody: unknown
): Promise<Record<string, unknown>> {
  const payload = parseRegisterPayload(rawBody);
  const context = recipeLogContext({
    userAddress: payload.userAddress,
    recipeType: payload.recipeType,
  });

  console.log(`[Keeper API] Register/Activate requested ${context}`);

  await assertTargetProtocolHasCode(payload.targetProtocol);

  const existingRecipe = await prisma.activeRecipe.findFirst({
    where: {
      userAddress: payload.userAddress,
      recipeType: payload.recipeType,
      targetProtocol: payload.targetProtocol,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (existingRecipe) {
    const updated = await prisma.activeRecipe.update({
      where: { id: existingRecipe.id },
      data: {
        status: RecipeStatus.ACTIVE,
        parametersJson: payload.parametersJson,
      },
    });

    console.log(
      `[Keeper API] Register/Activate updated existing recipe ${recipeLogContext({
        userAddress: updated.userAddress,
        recipeType: updated.recipeType,
        recipeId: updated.id,
      })}`
    );

    return {
      success: true,
      operation: 'updated',
      recipe: {
        id: updated.id,
        userAddress: updated.userAddress,
        recipeType: updated.recipeType,
        status: updated.status,
        targetProtocol: updated.targetProtocol,
      },
    };
  }

  const created = await prisma.activeRecipe.create({
    data: {
      recipeType: payload.recipeType,
      status: RecipeStatus.ACTIVE,
      targetProtocol: payload.targetProtocol,
      parametersJson: payload.parametersJson,
      user: {
        connectOrCreate: {
          where: { walletAddress: payload.userAddress },
          create: { walletAddress: payload.userAddress },
        },
      },
    },
  });

  console.log(
    `[Keeper API] Register/Activate created recipe ${recipeLogContext({
      userAddress: created.userAddress,
      recipeType: created.recipeType,
      recipeId: created.id,
    })}`
  );

  return {
    success: true,
    operation: 'created',
    recipe: {
      id: created.id,
      userAddress: created.userAddress,
      recipeType: created.recipeType,
      status: created.status,
      targetProtocol: created.targetProtocol,
    },
  };
}

export async function updateRecipeStatus(
  prisma: PrismaClient,
  rawBody: unknown
): Promise<Record<string, unknown>> {
  const payload = parseStatusPayload(rawBody);
  const context = recipeLogContext({
    userAddress: payload.userAddress,
    recipeType: payload.recipeType,
  });

  console.log(`[Keeper API] Status update requested ${context} targetStatus=${payload.status}`);

  const existingRecipe = await prisma.activeRecipe.findFirst({
    where: {
      userAddress: payload.userAddress,
      recipeType: payload.recipeType,
    },
    orderBy: { updatedAt: 'desc' },
  });

  if (!existingRecipe) {
    console.warn(`[Keeper API] Status update skipped - recipe not found ${context}`);
    throw new Error('No matching recipe found to update status.');
  }

  const updated = await prisma.activeRecipe.update({
    where: { id: existingRecipe.id },
    data: { status: payload.status },
  });

  console.log(
    `[Keeper API] Status updated ${recipeLogContext({
      userAddress: updated.userAddress,
      recipeType: updated.recipeType,
      recipeId: updated.id,
    })} newStatus=${updated.status}`
  );

  return {
    success: true,
    recipe: {
      id: updated.id,
      userAddress: updated.userAddress,
      recipeType: updated.recipeType,
      status: updated.status,
      targetProtocol: updated.targetProtocol,
    },
  };
}

function parseListExecutionLogsPayload(rawQuery: unknown): {
  userAddress?: string;
  limit: number;
} {
  if (!isRecord(rawQuery)) {
    return { limit: 25 };
  }

  const query = rawQuery as ListExecutionLogsPayload;
  const parsedLimit = Number(query.limit ?? 25);
  const limit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(100, Math.floor(parsedLimit)))
    : 25;

  const userAddress = query.userAddress !== undefined
    ? normalizeAddress(query.userAddress, 'userAddress')
    : undefined;

  return {
    userAddress,
    limit,
  };
}

function toRelativeTime(timestamp: Date): string {
  const diffMs = Date.now() - timestamp.getTime();
  if (diffMs < 60_000) {
    return 'just now';
  }

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) {
    return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export async function listExecutionLogs(
  prisma: PrismaClient,
  rawQuery: unknown
): Promise<Record<string, unknown>> {
  const payload = parseListExecutionLogsPayload(rawQuery);

  const logs = await prisma.executionLog.findMany({
    where: payload.userAddress
      ? {
        recipe: {
          userAddress: payload.userAddress,
        },
      }
      : undefined,
    include: {
      recipe: {
        select: {
          id: true,
          recipeType: true,
          userAddress: true,
        },
      },
    },
    orderBy: { simulatedAt: 'desc' },
    take: payload.limit,
  });

  return {
    success: true,
    logs: logs.map((log) => {
      const eventTimestamp = log.executedAt || log.simulatedAt;
      return {
        id: log.id,
        recipeId: log.activeRecipeId,
        recipeType: log.recipe.recipeType,
        userAddress: log.recipe.userAddress,
        txHash: log.txHash,
        timestamp: toRelativeTime(eventTimestamp),
        timestampIso: eventTimestamp.toISOString(),
        status: log.status,
        gasUsedUsdc: log.gasUsedUsdc ? `${log.gasUsedUsdc} USDC` : null,
        errorMessage: log.errorMessage,
      };
    }),
  };
}