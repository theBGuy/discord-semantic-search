import {
  type ChatMessage,
  chat,
  config,
  EMBED_QUERY_PREFIX,
  embedOne,
  getChatModel,
  getLocalChatModel,
  logger,
  type SearchHit,
  semanticSearch,
} from "@app/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { toCitations } from "../citations";
import { fullFiltersSchema } from "../schemas";

const askSchema = z.object({
  question: z.string().min(1),
  filters: fullFiltersSchema,
});

const SYSTEM_PROMPT = `You answer questions using ONLY the provided Discord message excerpts.
Each excerpt is numbered like [1], [2]. Cite the excerpts you use inline, e.g. [1].
If the answer is not contained in the excerpts, say you don't know — do not invent facts.
Be concise and direct.`;

/** Pack the highest-ranked hits into a context window under a char budget
 * (~3 chars/token, conservative) and return the hits actually used (for citations). */
function buildContext(hits: SearchHit[]): { context: string; used: SearchHit[] } {
  const charBudget = Math.max(1000, (config.NUM_CTX - 1024) * 3);
  const blocks: string[] = [];
  const used: SearchHit[] = [];
  let total = 0;

  for (const hit of hits) {
    const channel = hit.channelName ? `#${hit.channelName}` : `channel ${hit.channelId}`;
    const header = `[${used.length + 1}] ${channel} — ${hit.authorName} (${hit.ts})`;
    const block = `${header}\n${hit.chunkText}`;
    if (total + block.length > charBudget && used.length > 0) break;
    blocks.push(block);
    used.push(hit);
    total += block.length;
  }
  return { context: blocks.join("\n\n"), used };
}

export function registerAskRoute(app: FastifyInstance): void {
  app.post("/ask", async (req, reply) => {
    const parsed = askSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid request", details: parsed.error.issues });
    }
    const { question, filters } = parsed.data;

    let used: SearchHit[];
    let context: string;
    try {
      const queryEmbedding = await embedOne(EMBED_QUERY_PREFIX + question);
      const hits = await semanticSearch(queryEmbedding, config.RAG_TOP_K, filters);
      ({ context, used } = buildContext(hits));
    } catch (err) {
      logger.error({ err }, "ask retrieval failed");
      return reply.status(503).send({ error: "search backend unavailable" });
    }

    if (used.length === 0) {
      return reply.send({
        answer: "I couldn't find anything relevant in the indexed messages.",
        citations: [],
      });
    }

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Context:\n\n${context}\n\nQuestion: ${question}` },
    ];

    try {
      const [model, localModel] = await Promise.all([getChatModel(), getLocalChatModel()]);
      const answer = await chat(messages, { model, localModel });
      logger.info({ citations: used.length }, "ask served");
      return reply.send({ answer, citations: toCitations(used) });
    } catch (err) {
      logger.error({ err }, "ask generation failed");
      return reply.status(503).send({ error: "model unavailable, try again" });
    }
  });
}
