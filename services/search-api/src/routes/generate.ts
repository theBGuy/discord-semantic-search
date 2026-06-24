import {
  type ChatMessage,
  chat,
  config,
  EMBED_QUERY_PREFIX,
  embedOne,
  getChatModel,
  getLocalChatModel,
  getRecentMessages,
  logger,
  type RecentMessage,
  type SearchHit,
  semanticSearch,
} from "@app/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { toCitations } from "../citations";
import { accessFiltersSchema } from "../schemas";

const CHAR_BUDGET = Math.max(2000, (config.NUM_CTX - 1024) * 3);

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

/** Pack chronological messages into a transcript under the context budget. */
function buildTranscript(messages: RecentMessage[]): { transcript: string; used: number } {
  const lines: string[] = [];
  let total = 0;
  for (const m of messages) {
    const ch = m.channelName ? `#${m.channelName}` : `channel ${m.channelId}`;
    const when = m.ts.replace("T", " ").slice(0, 16);
    const line = `[${ch} | ${m.authorName} | ${when}] ${m.content.replace(/\s+/g, " ").trim()}`;
    if (total + line.length > CHAR_BUDGET && lines.length > 0) break;
    lines.push(line);
    total += line.length;
  }
  return { transcript: lines.join("\n"), used: lines.length };
}

/** Pack semantic hits (best chunk per message) into a numbered context for KB synthesis. */
function buildHitContext(hits: SearchHit[]): { context: string; used: SearchHit[] } {
  const blocks: string[] = [];
  const used: SearchHit[] = [];
  let total = 0;
  for (const h of hits) {
    const ch = h.channelName ? `#${h.channelName}` : `channel ${h.channelId}`;
    const block = `[${used.length + 1}] [${ch} | ${h.authorName} | ${h.ts.slice(0, 16)}] ${h.chunkText}`;
    if (total + block.length > CHAR_BUDGET && used.length > 0) break;
    blocks.push(block);
    used.push(h);
    total += block.length;
  }
  return { context: blocks.join("\n\n"), used };
}

async function generate(system: string, user: string): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  const [model, localModel] = await Promise.all([getChatModel(), getLocalChatModel()]);
  return chat(messages, { model, localModel });
}

const SUMMARIZE_SYSTEM = `You summarize a Discord conversation transcript. Produce:
- A 2–4 sentence overview of what was discussed.
- Bullet points of the key topics, decisions, and any open questions.
Be concise and factual. Use ONLY the transcript; do not invent. If it is mostly chit-chat, say so briefly.`;

const DIGEST_SYSTEM = `You are given recent Discord messages from multiple channels. Identify the main discussion topics (aim for 3–7). For each, give a short **bold heading** and one or two sentences summarizing it, mentioning the channel(s) when clear. Use ONLY the provided messages; do not invent.`;

const KB_SYSTEM = {
  faq: `From the Discord messages about "{topic}", write a concise FAQ: a handful of clear **Q:** / **A:** pairs capturing the most useful information. Use ONLY the provided messages. Note where something is uncertain or contested.`,
  decisions: `From the Discord messages about "{topic}", extract a decision log: list decisions made, with who/when if available and a one-line rationale each. Use ONLY the provided messages; if there are no clear decisions, say so.`,
  timeline: `From the Discord messages about "{topic}", produce a chronological timeline (date — what happened) of the key events/developments. Use ONLY the provided messages.`,
};

const summarizeSchema = z.object({
  channelId: z.string().optional(),
  hours: z.number().int().positive().max(8760).optional(),
  filters: accessFiltersSchema,
});
const digestSchema = z.object({
  hours: z.number().int().positive().max(8760).optional(),
  filters: accessFiltersSchema,
});
const kbSchema = z.object({
  topic: z.string().min(1),
  kind: z.enum(["faq", "decisions", "timeline"]).default("faq"),
  filters: accessFiltersSchema,
});

export function registerGenerateRoutes(app: FastifyInstance): void {
  app.post("/summarize", async (req, reply) => {
    const parsed = summarizeSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid request", details: parsed.error.issues });
    }
    const { channelId, hours, filters } = parsed.data;
    try {
      const messages = await getRecentMessages({
        guildIds: filters.guildIds,
        channelId,
        channelIds: filters.channelIds,
        sinceIso: hoursAgoIso(hours ?? 24),
        limit: config.SUMMARIZE_MAX_MESSAGES,
      });
      if (messages.length === 0) {
        return reply.send({ summary: "Nothing to summarize in that window.", messageCount: 0 });
      }
      const { transcript, used } = buildTranscript(messages);
      const summary = await generate(SUMMARIZE_SYSTEM, `Transcript:\n\n${transcript}`);
      logger.info({ used }, "summarize served");
      return reply.send({ summary, messageCount: used });
    } catch (err) {
      logger.error({ err }, "summarize failed");
      return reply.status(503).send({ error: "model unavailable, try again" });
    }
  });

  app.post("/digest", async (req, reply) => {
    const parsed = digestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid request", details: parsed.error.issues });
    }
    const { hours, filters } = parsed.data;
    try {
      const messages = await getRecentMessages({
        guildIds: filters.guildIds,
        channelIds: filters.channelIds,
        sinceIso: hoursAgoIso(hours ?? 24),
        limit: config.DIGEST_MAX_MESSAGES,
      });
      if (messages.length === 0) {
        return reply.send({ digest: "No recent activity to digest.", messageCount: 0 });
      }
      const { transcript, used } = buildTranscript(messages);
      const digest = await generate(DIGEST_SYSTEM, `Messages:\n\n${transcript}`);
      logger.info({ used }, "digest served");
      return reply.send({ digest, messageCount: used });
    } catch (err) {
      logger.error({ err }, "digest failed");
      return reply.status(503).send({ error: "model unavailable, try again" });
    }
  });

  app.post("/kb", async (req, reply) => {
    const parsed = kbSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid request", details: parsed.error.issues });
    }
    const { topic, kind, filters } = parsed.data;
    try {
      const embedding = await embedOne(EMBED_QUERY_PREFIX + topic);
      const hits = await semanticSearch(embedding, config.KB_TOP_K, {
        guildIds: filters.guildIds,
        channelIds: filters.channelIds,
      });
      if (hits.length === 0) {
        return reply.send({ content: "No relevant messages found for that topic.", citations: [] });
      }
      const { context, used } = buildHitContext(hits);
      const system = KB_SYSTEM[kind].replace("{topic}", topic);
      const content = await generate(system, `Messages about "${topic}":\n\n${context}`);
      logger.info({ kind, used: used.length }, "kb served");
      return reply.send({ content, citations: toCitations(used) });
    } catch (err) {
      logger.error({ err }, "kb failed");
      return reply.status(503).send({ error: "model unavailable, try again" });
    }
  });
}
