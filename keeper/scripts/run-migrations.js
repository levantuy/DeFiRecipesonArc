require('dotenv/config');

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');

const DEFAULT_DB_SCHEMA = 'recipes';

function resolveSchemaName(databaseUrl) {
  if (!databaseUrl) {
    return DEFAULT_DB_SCHEMA;
  }

  try {
    const schemaFromUrl = new URL(databaseUrl).searchParams.get('schema');
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

function quoteIdentifier(value) {
  return `"${value.replace(/"/g, '""')}"`;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }

  const schema = resolveSchemaName(databaseUrl);
  const schemaQualifiedMigrationsTable = `${quoteIdentifier(schema)}."_sql_migrations"`;
  const searchPath = schema;

  const migrationsDir = path.resolve(__dirname, '../db-migrations/migrations');
  const client = new Client({
    connectionString: databaseUrl,
    options: `-c search_path=${searchPath}`,
  });
  await client.connect();

  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schema)}`);

    await client.query({
      name: 'migration-table-create',
      text: `
        CREATE TABLE IF NOT EXISTS ${schemaQualifiedMigrationsTable} (
          id TEXT PRIMARY KEY,
          checksum TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `,
      values: [],
    });

    await client.query(`
      DO $$
      BEGIN
        IF to_regclass('public._sql_migrations') IS NOT NULL THEN
          INSERT INTO ${schemaQualifiedMigrationsTable} (id, checksum, applied_at)
          SELECT id, checksum, applied_at
          FROM public."_sql_migrations"
          ON CONFLICT (id) DO NOTHING;
        END IF;
      END
      $$;
    `);

    const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
    const migrationFolders = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    for (const folderName of migrationFolders) {
      const migrationId = folderName;
      const migrationPath = path.join(migrationsDir, folderName, 'migration.sql');

      let sql;
      try {
        sql = await fs.readFile(migrationPath, 'utf8');
      } catch {
        continue;
      }

      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const existsResult = await client.query({
        name: 'migration-select-by-id',
        text: `SELECT checksum FROM ${schemaQualifiedMigrationsTable} WHERE id = $1`,
        values: [migrationId],
      });

      if (existsResult.rows.length > 0) {
        const appliedChecksum = existsResult.rows[0].checksum;
        if (appliedChecksum !== checksum) {
          throw new Error(
            `Migration ${migrationId} checksum mismatch. Applied=${appliedChecksum}, current=${checksum}`
          );
        }
        console.log(`[migrate] skip ${migrationId} (already applied)`);
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(`SET LOCAL search_path TO ${searchPath}`);
        await client.query(sql);
        await client.query({
          name: 'migration-insert-applied',
          text: `INSERT INTO ${schemaQualifiedMigrationsTable} (id, checksum) VALUES ($1, $2)`,
          values: [migrationId, checksum],
        });
        await client.query('COMMIT');
        console.log(`[migrate] applied ${migrationId}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[migrate] failed:', error.message);
  process.exit(1);
});
