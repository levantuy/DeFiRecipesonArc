import { randomUUID } from 'node:crypto';
import { query } from '../client';
import { ExecutionLogRecord, ExecutionLogWithRecipeRecord, ExecutionStatus } from '../types';

interface ExecutionLogRow {
  id: string;
  activeRecipeId: string;
  status: ExecutionStatus;
  txHash: string | null;
  gasUsedUsdc: string | null;
  simulatedAt: Date;
  executedAt: Date | null;
  errorMessage: string | null;
}

interface ExecutionLogWithRecipeRow extends ExecutionLogRow {
  recipeId: string;
  recipeType: string;
  recipeUserAddress: string;
}

function mapExecutionLogRow(row: ExecutionLogRow): ExecutionLogRecord {
  return {
    id: row.id,
    activeRecipeId: row.activeRecipeId,
    status: row.status,
    txHash: row.txHash,
    gasUsedUsdc: row.gasUsedUsdc,
    simulatedAt: row.simulatedAt,
    executedAt: row.executedAt,
    errorMessage: row.errorMessage,
  };
}

function mapExecutionLogWithRecipeRow(row: ExecutionLogWithRecipeRow): ExecutionLogWithRecipeRecord {
  return {
    ...mapExecutionLogRow(row),
    recipeId: row.recipeId,
    recipeType: row.recipeType as ExecutionLogWithRecipeRecord['recipeType'],
    recipeUserAddress: row.recipeUserAddress,
  };
}

export const executionLogsRepository = {
  async createSimulatingLog(activeRecipeId: string): Promise<ExecutionLogRecord> {
    const now = new Date();
    const rows = await query<ExecutionLogRow>({
      name: 'execution-log-create-simulating',
      text: `
        INSERT INTO "ExecutionLog" (
          id,
          "activeRecipeId",
          status,
          "simulatedAt"
        ) VALUES (
          $1,
          $2,
          $3::"ExecutionStatus",
          $4
        )
        RETURNING
          id,
          "activeRecipeId",
          status,
          "txHash",
          "gasUsedUsdc"::text AS "gasUsedUsdc",
          "simulatedAt",
          "executedAt",
          "errorMessage"
      `,
      values: [randomUUID(), activeRecipeId, ExecutionStatus.SIMULATING, now],
    });

    return mapExecutionLogRow(rows[0]);
  },

  async updateLogStatus(input: {
    executionLogId: string;
    status: ExecutionStatus;
    errorMessage?: string | null;
    txHash?: string | null;
    executedAt?: Date | null;
    gasUsedUsdc?: string | null;
  }): Promise<void> {
    const now = new Date();
    await query({
      name: 'execution-log-update-status',
      text: `
        UPDATE "ExecutionLog"
        SET
          status = $2::"ExecutionStatus",
          "errorMessage" = CASE WHEN $3::boolean THEN $4 ELSE "errorMessage" END,
          "txHash" = CASE WHEN $5::boolean THEN $6 ELSE "txHash" END,
          "executedAt" = CASE WHEN $7::boolean THEN $8 ELSE "executedAt" END,
          "gasUsedUsdc" = CASE WHEN $9::boolean THEN $10::decimal(18,6) ELSE "gasUsedUsdc" END
        WHERE id = $1
      `,
      values: [
        input.executionLogId,
        input.status,
        input.errorMessage !== undefined,
        input.errorMessage ?? null,
        input.txHash !== undefined,
        input.txHash ?? null,
        input.executedAt !== undefined,
        input.executedAt ?? null,
        input.gasUsedUsdc !== undefined,
        input.gasUsedUsdc ?? null,
      ],
    });
  },

  async listRecentLogs(input: {
    userAddress?: string;
    limit: number;
  }): Promise<ExecutionLogWithRecipeRecord[]> {
    const rows = await query<ExecutionLogWithRecipeRow>({
      name: 'execution-log-list-recent',
      text: `
        SELECT
          e.id,
          e."activeRecipeId",
          e.status,
          e."txHash",
          e."gasUsedUsdc"::text AS "gasUsedUsdc",
          e."simulatedAt",
          e."executedAt",
          e."errorMessage",
          r.id AS "recipeId",
          r."recipeType" AS "recipeType",
          r."userAddress" AS "recipeUserAddress"
        FROM "ExecutionLog" e
        INNER JOIN "ActiveRecipe" r ON r.id = e."activeRecipeId"
        WHERE ($1::text IS NULL OR r."userAddress" = $1)
        ORDER BY e."simulatedAt" DESC
        LIMIT $2
      `,
      values: [input.userAddress ?? null, input.limit],
    });

    return rows.map(mapExecutionLogWithRecipeRow);
  },
};
