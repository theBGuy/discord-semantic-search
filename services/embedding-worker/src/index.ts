import {
  closePool,
  config,
  EMBED_DOC_PREFIX,
  embedOne,
  getCorpusModels,
  logger,
  stopBoss,
  workAttachments,
  workMessages,
} from "@app/shared";
import { processAttachmentJob, processMessageJob } from "./handlers";

/** Verify the embedding model is reachable and produces the expected dimension.
 * A dimension mismatch is fatal (misconfiguration); a connection error is tolerated
 * (jobs retry via the queue once Ollama is healthy). */
async function assertEmbedModel(): Promise<void> {
  try {
    const vec = await embedOne(`${EMBED_DOC_PREFIX}healthcheck`);
    if (vec.length !== config.EMBED_DIM) {
      logger.fatal(
        { got: vec.length, expected: config.EMBED_DIM, model: config.EMBED_MODEL },
        "embedding dimension mismatch — fix EMBED_MODEL/EMBED_DIM",
      );
      process.exit(1);
    }
    logger.info({ model: config.EMBED_MODEL, dim: vec.length }, "embedding model ready");
  } catch (err) {
    logger.warn({ err }, "could not verify embedding model at startup; will rely on job retries");
  }
}

/** Warn if the corpus already contains embeddings from a different model/dimension.
 * Mixed-model vectors share one index and silently degrade search until re-embedded. */
async function checkModelDrift(): Promise<void> {
  try {
    const corpus = await getCorpusModels();
    const drift = corpus.filter(
      (c) => c.model !== config.EMBED_MODEL || c.dim !== config.EMBED_DIM,
    );
    if (drift.length > 0) {
      logger.warn(
        { configured: { model: config.EMBED_MODEL, dim: config.EMBED_DIM }, found: corpus },
        "embedding model drift: corpus has vectors from another model/dim — re-embed after a model change",
      );
    }
  } catch (err) {
    logger.debug({ err }, "model drift check skipped");
  }
}

async function main(): Promise<void> {
  logger.info(
    { embedModel: config.EMBED_MODEL, embedDim: config.EMBED_DIM },
    "embedding-worker starting",
  );
  await assertEmbedModel();
  await checkModelDrift();

  await workMessages(processMessageJob, config.WORKER_CONCURRENCY);
  await workAttachments(processAttachmentJob, config.WORKER_CONCURRENCY);
  logger.info({ concurrency: config.WORKER_CONCURRENCY }, "workers registered");
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "shutting down embedding-worker");
  await stopBoss().catch((err) => logger.error({ err }, "error stopping pg-boss"));
  await closePool().catch(() => {});
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main().catch((err) => {
  logger.fatal({ err }, "embedding-worker failed to start");
  process.exit(1);
});
