/** `pnpm reembed` — re-embed all stored message/attachment text at the configured
 * model + dimension (used after switching EMBED_MODEL). No Discord re-crawl. */
import { config } from "./config";
import { closePool } from "./db";
import { logger } from "./logger";
import { reembedAll } from "./reembed";

try {
  logger.info(
    { model: config.EMBED_MODEL, dim: config.EMBED_DIM },
    "reembed: reprovisioning column + re-embedding stored text",
  );
  const result = await reembedAll();
  logger.info(result, "reembed complete");
  await closePool();
  process.exit(0);
} catch (err) {
  logger.error({ err }, "reembed failed");
  await closePool().catch(() => {});
  process.exit(1);
}
