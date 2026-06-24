import { z } from "zod";

/** Coerce common truthy/falsy env strings to a boolean. */
const envBool = (def: boolean) =>
  z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return def;
      if (typeof v === "boolean") return v;
      return ["1", "true", "yes", "on"].includes(v.toLowerCase());
    });

const schema = z.object({
  // ── Discord ────────────────────────────────────────────────────────────────
  DISCORD_TOKEN: z.string().default(""),
  DISCORD_CLIENT_ID: z.string().default(""),
  DISCORD_DEV_GUILD_ID: z.string().optional(),
  SKIP_BOT_MESSAGES: envBool(true),
  BACKFILL_ON_START: envBool(false),
  // How many channels/threads to crawl concurrently during backfill.
  BACKFILL_CONCURRENCY: z.coerce.number().int().positive().max(10).default(3),

  // ── Postgres ─────────────────────────────────────────────────────────────--
  DATABASE_URL: z.string().optional(),
  POSTGRES_HOST: z.string().default("postgres"),
  POSTGRES_PORT: z.coerce.number().int().default(5432),
  POSTGRES_USER: z.string().default("discord"),
  POSTGRES_PASSWORD: z.string().default("postgres"),
  POSTGRES_DB: z.string().default("discord_search"),

  // ── Ollama ───────────────────────────────────────────────────────────────--
  // Embeddings ALWAYS use OLLAMA_BASE_URL (kept local — high volume). Chat/RAG uses
  // OLLAMA_CLOUD_URL as primary when set, falling back to OLLAMA_BASE_URL on a session
  // limit (HTTP 429) for OLLAMA_CLOUD_COOLDOWN_MS.
  OLLAMA_BASE_URL: z.string().default("http://ollama:11434"),
  OLLAMA_API_KEY: z.string().optional(),
  OLLAMA_CLOUD_URL: z.string().optional(),
  OLLAMA_CLOUD_API_KEY: z.string().optional(),
  OLLAMA_CLOUD_COOLDOWN_MS: z.coerce.number().int().positive().default(300_000),
  EMBED_MODEL: z.string().default("nomic-embed-text"),
  EMBED_DIM: z.coerce.number().int().positive().default(768),
  // Retrieval prefixes. Default to nomic-embed-text's asymmetric convention; set
  // both empty for models that don't use prefixes (e.g. qwen3-embedding, mxbai).
  EMBED_DOC_PREFIX: z.string().default("search_document: "),
  EMBED_QUERY_PREFIX: z.string().default("search_query: "),
  CHAT_MODEL: z.string().default("qwen2.5:7b"),
  // Optional smaller model used when chat falls back to the local endpoint. Defaults
  // to CHAT_MODEL when unset (same model on both).
  CHAT_MODEL_LOCAL: z.string().optional(),
  NUM_CTX: z.coerce.number().int().positive().default(8192),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

  // ── Search / RAG ───────────────────────────────────────────────────────────
  FTS_LANG: z.string().default("english"),
  SEARCH_TOP_N: z.coerce.number().int().positive().default(10),
  RAG_TOP_K: z.coerce.number().int().positive().default(25),
  // ── AI features (Phase 4) ──
  SUMMARIZE_MAX_MESSAGES: z.coerce.number().int().positive().default(400),
  DIGEST_MAX_MESSAGES: z.coerce.number().int().positive().default(300),
  KB_TOP_K: z.coerce.number().int().positive().default(30),
  ANN_OVERSAMPLE: z.coerce.number().int().positive().default(20),
  HNSW_EF_SEARCH: z.coerce.number().int().positive().default(60),
  // Hybrid-search Reciprocal Rank Fusion: RRF_K damps the weight of low ranks
  // (score = 1/(RRF_K + rank)); RRF_CAP_MIN floors how many candidates each arm
  // (vector + full-text) keeps before fusion (the cap is max(topN*2, RRF_CAP_MIN)).
  RRF_K: z.coerce.number().int().positive().default(50),
  RRF_CAP_MIN: z.coerce.number().int().positive().default(30),

  // ── Chunking ─────────────────────────────────────────────────────────────--
  CHUNK_MAX_CHARS: z.coerce.number().int().positive().default(1800),
  CHUNK_OVERLAP_CHARS: z.coerce.number().int().nonnegative().default(200),
  MAX_CHUNKS_PER_JOB: z.coerce.number().int().positive().default(64),
  // Embedding jobs processed concurrently per worker. For real speedup, also raise
  // OLLAMA_NUM_PARALLEL on the embedding Ollama so it embeds in parallel.
  WORKER_CONCURRENCY: z.coerce.number().int().positive().max(16).default(3),

  // ── Attachments ──────────────────────────────────────────────────────────--
  ATTACHMENT_MAX_BYTES: z.coerce.number().int().positive().default(10_485_760),
  // Abort an attachment download that stalls past this (ms) so a hung CDN socket
  // can't hold a queue job open past its visibility window.
  ATTACHMENT_DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  // ── OCR (Phase 3): extract text from image attachments via Tesseract ───────--
  OCR_ENABLED: envBool(true),
  OCR_LANG: z.string().default("eng"),
  // Ignore OCR output shorter than this (avoids indexing noise from text-free images).
  OCR_MIN_CHARS: z.coerce.number().int().nonnegative().default(8),
  OCR_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

  // ── Services ─────────────────────────────────────────────────────────────--
  SEARCH_API_URL: z.string().default("http://search-api:3000"),
  SEARCH_API_PORT: z.coerce.number().int().positive().default(3000),
  // Abort a bot->search-api request that stalls past this (ms) so the slash
  // interaction fails cleanly instead of hanging until Discord's deadline.
  SEARCH_API_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

  // ── Governance ─────────────────────────────────────────────────────────────
  // Discord user IDs that are ALWAYS bot admins (comma-separated). Cannot be locked out.
  BOOTSTRAP_ADMIN_IDS: z.string().default(""),
  // Default per-user command rate limit (commands/hour; 0 = unlimited). Admins exempt.
  RATE_LIMIT_PER_HOUR: z.coerce.number().int().nonnegative().default(30),

  // ── Logging ──────────────────────────────────────────────────────────────--
  LOG_LEVEL: z.string().default("info"),
  NODE_ENV: z.string().default("production"),
});

const parsed = schema.parse(process.env);

/** Postgres connection string (DATABASE_URL wins, else assembled from parts). */
export const databaseUrl =
  parsed.DATABASE_URL ??
  `postgres://${encodeURIComponent(parsed.POSTGRES_USER)}:${encodeURIComponent(
    parsed.POSTGRES_PASSWORD,
  )}@${parsed.POSTGRES_HOST}:${parsed.POSTGRES_PORT}/${parsed.POSTGRES_DB}`;

/** Embedding task prefixes (configurable; default to nomic's asymmetric convention). */
export const EMBED_DOC_PREFIX = parsed.EMBED_DOC_PREFIX;
export const EMBED_QUERY_PREFIX = parsed.EMBED_QUERY_PREFIX;

/** Always-admin Discord user IDs from BOOTSTRAP_ADMIN_IDS. */
export const bootstrapAdminIds = new Set(
  parsed.BOOTSTRAP_ADMIN_IDS.split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

export const config = { ...parsed, databaseUrl } as const;
export type Config = typeof config;
