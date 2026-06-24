/** Entry point for the one-shot `migrate` compose service (and `pnpm migrate`). */
import { config } from "./config";
import { closePool, runMigrations } from "./db";
import { logger } from "./logger";
import { ensureEmbeddingDimension } from "./reembed";

try {
  await runMigrations();
  await ensureEmbeddingDimension(config.EMBED_DIM);
  await closePool();
  process.exit(0);
} catch (err) {
  logger.error({ err }, "migration failed");
  await closePool().catch(() => {});
  process.exit(1);
}
