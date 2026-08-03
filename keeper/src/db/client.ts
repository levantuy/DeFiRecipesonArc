import { Pool, PoolClient, QueryConfig, QueryResultRow } from 'pg';

let pool: Pool | null = null;

const DEFAULT_DB_SCHEMA = 'recipes';

function resolveDbSchema(connectionString: string): string {
  try {
    const schemaFromUrl = new URL(connectionString).searchParams.get('schema');
    const schema = schemaFromUrl || process.env.DB_SCHEMA || DEFAULT_DB_SCHEMA;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
      throw new Error(`Invalid schema name: ${schema}`);
    }
    return schema;
  } catch {
    const schema = process.env.DB_SCHEMA || DEFAULT_DB_SCHEMA;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
      throw new Error(`Invalid schema name: ${schema}`);
    }
    return schema;
  }
}

function getPool(): Pool {
  if (pool) {
    return pool;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required.');
  }

  const schema = resolveDbSchema(connectionString);

  pool = new Pool({
    connectionString,
    options: `-c search_path=${schema}`,
  });
  return pool;
}

export async function query<T extends QueryResultRow>(config: QueryConfig): Promise<T[]> {
  const result = await getPool().query<T>(config);
  return result.rows;
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query({ name: 'tx-begin', text: 'BEGIN', values: [] });
    const result = await work(client);
    await client.query({ name: 'tx-commit', text: 'COMMIT', values: [] });
    return result;
  } catch (error: unknown) {
    await client.query({ name: 'tx-rollback', text: 'ROLLBACK', values: [] });
    throw error;
  } finally {
    client.release();
  }
}

export async function connectDb(): Promise<void> {
  const client = await getPool().connect();
  client.release();
}

export async function disconnectDb(): Promise<void> {
  if (!pool) {
    return;
  }
  await pool.end();
  pool = null;
}

export async function checkDbHealth(): Promise<void> {
  await getPool().query({
    name: 'health-select-1',
    text: 'SELECT 1',
    values: [],
  });
}

export async function countActiveRecipes(): Promise<number> {
  const result = await getPool().query<{ count: string }>({
    name: 'count-active-recipes',
    text: 'SELECT COUNT(*)::text AS count FROM "ActiveRecipe"',
    values: [],
  });
  return Number(result.rows[0]?.count ?? '0');
}
