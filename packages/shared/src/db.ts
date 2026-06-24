import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { databaseUrl } from "./config";
import { logger } from "./logger";

const { Pool } = pg;

/** Shared connection pool. node-postgres returns BIGINT (int8) columns as JS strings
 * by default, which is exactly what we want for lossless snowflake handling. */
export const pool = new Pool({ connectionString: databaseUrl, max: 10 });

export type DbClient = pg.PoolClient;

/** Run `fn` on a dedicated client wrapped in BEGIN/COMMIT (ROLLBACK on throw). */
export async function withTransaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Format a numeric array as a pgvector literal, e.g. [1,2,3] -> "[1,2,3]".
 * Bind the result as a text param and cast `$n::vector` in SQL. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

function migrationsDir(): string {
  if (process.env.MIGRATIONS_DIR) return resolve(process.env.MIGRATIONS_DIR);
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "../../../db/migrations");
}

/**
 * Apply pending SQL migrations in filename order, each in its own transaction.
 * Idempotent: already-applied files are tracked in `schema_migrations` and skipped,
 * and the migration SQL itself uses IF NOT EXISTS as a second layer of safety.
 */
export async function runMigrations(): Promise<void> {
  const dir = migrationsDir();
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename   TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );

  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const { rows } = await pool.query<{ filename: string }>("SELECT filename FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.filename));

  for (const file of files) {
    if (applied.has(file)) {
      logger.debug({ file }, "migration already applied");
      continue;
    }
    const sql = await readFile(join(dir, file), "utf8");
    logger.info({ file }, "applying migration");
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
    });
  }
  logger.info({ count: files.length }, "migrations up to date");
}

export async function closePool(): Promise<void> {
  await pool.end();
}
