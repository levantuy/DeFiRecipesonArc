import { recipesRepository } from '../db/repositories/recipesRepository';
import { executionLogsRepository } from '../db/repositories/executionLogsRepository';
import { JsonObject, RecipeStatus, RecipeType, SwapProvider } from '../db/types';
import type { Address } from 'viem';
import { publicClient } from '../simulation/staticSimulationEngine';
import {
  parseDcaMaxSlippageBpsStrict,
  parseDcaTargetAssetSymbolStrict,
} from '../config/dcaRouting';

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const RECIPE_TYPE_SET = new Set(Object.values(RecipeType));
const RECIPE_STATUS_SET = new Set(Object.values(RecipeStatus));
const SWAP_PROVIDER_SET = new Set(Object.values(SwapProvider));

interface RegisterRecipePayload {
  userAddress?: unknown;
  recipeType?: unknown;
  targetProtocol?: unknown;
  swapProvider?: unknown;
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

function parseSwapProvider(value: unknown): SwapProvider {
  if (typeof value !== 'string' || !SWAP_PROVIDER_SET.has(value as SwapProvider)) {
    throw new Error(`swapProvider must be one of: ${Array.from(SWAP_PROVIDER_SET).join(', ')}`);
  }
  return value as SwapProvider;
}

function parseRegisterPayload(rawBody: unknown): {
  userAddress: string;
  recipeType: RecipeType;
  targetProtocol: string | null;
  swapProvider: SwapProvider | null;
  parametersJson: JsonObject;
} {
  if (!isRecord(rawBody)) {
    throw new Error('Request body must be a JSON object.');
  }

  const body = rawBody as RegisterRecipePayload;
  const userAddress = normalizeAddress(body.userAddress, 'userAddress');
  const recipeType = parseRecipeType(body.recipeType);
  const swapProvider = body.swapProvider === undefined
    ? null
    : parseSwapProvider(body.swapProvider);
  const targetProtocol = body.targetProtocol === undefined
    ? null
    : normalizeAddress(body.targetProtocol, 'targetProtocol');

  let parametersJson: JsonObject = {};
  if (body.parametersJson !== undefined) {
    if (!isRecord(body.parametersJson)) {
      throw new Error('parametersJson must be a JSON object when provided.');
    }
    parametersJson = body.parametersJson;
  }

  if (recipeType === RecipeType.RECURRING_DCA) {
    if (!targetProtocol && swapProvider !== 'ARC_APP_KIT_SWAP') {
      throw new Error('RECURRING_DCA requires targetProtocol or swapProvider=ARC_APP_KIT_SWAP.');
    }

    if (isRecord(parametersJson) && (parametersJson as Record<string, unknown>).maxSlippageBps !== undefined) {
      parseDcaMaxSlippageBpsStrict((parametersJson as Record<string, unknown>).maxSlippageBps);
    }

    if (isRecord(parametersJson) && (parametersJson as Record<string, unknown>).targetAssetSymbol !== undefined) {
      parseDcaTargetAssetSymbolStrict((parametersJson as Record<string, unknown>).targetAssetSymbol);
    }
  }

  if (recipeType !== RecipeType.RECURRING_DCA && !targetProtocol && !swapProvider) {
    throw new Error('Either targetProtocol or swapProvider is required.');
  }

  return {
    userAddress,
    recipeType,
    targetProtocol,
    swapProvider,
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
  rawBody: unknown
): Promise<Record<string, unknown>> {
  const payload = parseRegisterPayload(rawBody);
  const context = recipeLogContext({
    userAddress: payload.userAddress,
    recipeType: payload.recipeType,
  });

  console.log(`[Keeper API] Register/Activate requested ${context}`);

  if (payload.targetProtocol) {
    await assertTargetProtocolHasCode(payload.targetProtocol);
  }

  const existingRecipe = await recipesRepository.findMatchingForRegistration({
    userAddress: payload.userAddress,
    recipeType: payload.recipeType,
    targetProtocol: payload.targetProtocol,
    swapProvider: payload.swapProvider,
  });

  if (existingRecipe) {
    const updated = await recipesRepository.updateForActivation(existingRecipe.id, {
      status: RecipeStatus.ACTIVE,
      targetProtocol: payload.targetProtocol,
      swapProvider: payload.swapProvider,
      parametersJson: payload.parametersJson,
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
        swapProvider: updated.swapProvider ?? null,
      },
    };
  }

  const created = await recipesRepository.createWithUserConnectOrCreate({
    userAddress: payload.userAddress,
    recipeType: payload.recipeType,
    targetProtocol: payload.targetProtocol,
    swapProvider: payload.swapProvider,
    parametersJson: payload.parametersJson,
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
      swapProvider: created.swapProvider ?? null,
    },
  };
}

export async function updateRecipeStatus(
  rawBody: unknown
): Promise<Record<string, unknown>> {
  const payload = parseStatusPayload(rawBody);
  const context = recipeLogContext({
    userAddress: payload.userAddress,
    recipeType: payload.recipeType,
  });

  console.log(`[Keeper API] Status update requested ${context} targetStatus=${payload.status}`);

  const existingRecipe = await recipesRepository.findLatestByUserAndType(payload.userAddress, payload.recipeType);

  if (!existingRecipe) {
    console.warn(`[Keeper API] Status update skipped - recipe not found ${context}`);
    throw new Error('No matching recipe found to update status.');
  }

  const updated = await recipesRepository.updateStatus(existingRecipe.id, payload.status);

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
      swapProvider: updated.swapProvider ?? null,
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
  rawQuery: unknown
): Promise<Record<string, unknown>> {
  const payload = parseListExecutionLogsPayload(rawQuery);

  const logs = await executionLogsRepository.listRecentLogs({
    userAddress: payload.userAddress,
    limit: payload.limit,
  });

  return {
    success: true,
    logs: logs.map((log) => {
      const eventTimestamp = log.executedAt || log.simulatedAt;
      return {
        id: log.id,
        recipeId: log.activeRecipeId,
        recipeType: log.recipeType,
        userAddress: log.recipeUserAddress,
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