import { closePool, config, logger, pool, version } from "@app/shared";
import Fastify from "fastify";
import { registerAskRoute } from "./routes/ask";
import { registerGenerateRoutes } from "./routes/generate";
import { registerSearchRoute } from "./routes/search";

const app = Fastify({ logger: false });

// Liveness/readiness: Postgres reachable + Ollama answering. Uses /api/version,
// which does NOT load a model (so probing never pins the embed/chat model).
app.get("/health", async (_req, reply) => {
  try {
    await pool.query("SELECT 1");
  } catch (err) {
    logger.error({ err }, "health: postgres unreachable");
    return reply.status(503).send({ status: "error", postgres: false });
  }
  try {
    const v = await version();
    return reply.send({ status: "ok", postgres: true, ollama: v });
  } catch {
    return reply.status(503).send({ status: "error", postgres: true, ollama: false });
  }
});

registerSearchRoute(app);
registerAskRoute(app);
registerGenerateRoutes(app);

async function main(): Promise<void> {
  // Bind 0.0.0.0 inside the container; the compose file publishes NO host port,
  // so search-api stays reachable only on the internal network (queries stay private).
  await app.listen({ host: "0.0.0.0", port: config.SEARCH_API_PORT });
  logger.info({ port: config.SEARCH_API_PORT }, "search-api listening (internal network only)");
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "shutting down search-api");
  await app.close().catch(() => {});
  await closePool().catch(() => {});
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main().catch((err) => {
  logger.fatal({ err }, "search-api failed to start");
  process.exit(1);
});
