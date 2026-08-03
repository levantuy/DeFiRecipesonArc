require('dotenv/config');

const { Client } = require('pg');

const DEFAULT_USER_ADDRESS = '0x1111111111111111111111111111111111111111';
const DEFAULT_DB_SCHEMA = 'recipes';

function resolveSchemaName(connectionString) {
  if (!connectionString) {
    return DEFAULT_DB_SCHEMA;
  }

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

function buildSearchPath(schema) {
  return schema;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required.');
  }

  const userAddress = (process.env.CLEANUP_USER_ADDRESS || DEFAULT_USER_ADDRESS).toLowerCase();
  const schema = resolveSchemaName(connectionString);
  const client = new Client({
    connectionString,
    options: `-c search_path=${buildSearchPath(schema)}`,
  });

  await client.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query({
      name: 'cleanup-check-user-exists',
      text: 'SELECT id FROM "User" WHERE "walletAddress" = $1 LIMIT 1',
      values: [userAddress],
    });

    const recipeCountBefore = await client.query({
      name: 'cleanup-count-recipes-before',
      text: 'SELECT COUNT(*)::int AS count FROM "ActiveRecipe" WHERE "userAddress" = $1',
      values: [userAddress],
    });

    const logCountBefore = await client.query({
      name: 'cleanup-count-logs-before',
      text: `
        SELECT COUNT(*)::int AS count
        FROM "ExecutionLog" e
        INNER JOIN "ActiveRecipe" r ON r.id = e."activeRecipeId"
        WHERE r."userAddress" = $1
      `,
      values: [userAddress],
    });

    const sessionKeyCountBefore = await client.query({
      name: 'cleanup-count-session-keys-before',
      text: 'SELECT COUNT(*)::int AS count FROM "SessionKey" WHERE "userAddress" = $1',
      values: [userAddress],
    });

    let deletedUsers = 0;
    if (existing.rows.length > 0) {
      const deleted = await client.query({
        name: 'cleanup-delete-user-cascade',
        text: 'DELETE FROM "User" WHERE "walletAddress" = $1',
        values: [userAddress],
      });
      deletedUsers = deleted.rowCount || 0;
    }

    await client.query('COMMIT');

    console.log(
      JSON.stringify(
        {
          ok: true,
          userAddress,
          deletedUsers,
          removedByCascade: {
            activeRecipes: recipeCountBefore.rows[0]?.count || 0,
            executionLogs: logCountBefore.rows[0]?.count || 0,
            sessionKeys: sessionKeyCountBefore.rows[0]?.count || 0,
          },
        },
        null,
        2
      )
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`[cleanup] failed: ${error.message}`);
  process.exit(1);
});
