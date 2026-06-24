import {
  config,
  EMBED_QUERY_PREFIX,
  embedOne,
  hybridSearch,
  logger,
  semanticSearch,
} from "@app/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { fullFiltersSchema } from "../schemas";

const searchSchema = z.object({
  query: z.string().min(1),
  mode: z.enum(["semantic", "hybrid"]).default("semantic"),
  topN: z.number().int().positive().max(100).optional(),
  filters: fullFiltersSchema,
});

export function registerSearchRoute(app: FastifyInstance): void {
  app.post("/search", async (req, reply) => {
    const parsed = searchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid request", details: parsed.error.issues });
    }
    const { query, mode, topN, filters } = parsed.data;
    const n = topN ?? config.SEARCH_TOP_N;

    try {
      const queryEmbedding = await embedOne(EMBED_QUERY_PREFIX + query);
      const hits =
        mode === "hybrid"
          ? await hybridSearch(queryEmbedding, query, n, filters)
          : await semanticSearch(queryEmbedding, n, filters);
      // Avoid logging full query text / results at info level (privacy).
      logger.info({ mode, count: hits.length }, "search served");
      return reply.send({ mode, hits });
    } catch (err) {
      logger.error({ err }, "search failed");
      return reply.status(503).send({ error: "search backend unavailable" });
    }
  });
}
