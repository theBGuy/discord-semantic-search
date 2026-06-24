import { config } from "./config";
import { type DbClient, pool, toVectorLiteral, withTransaction } from "./db";
import type {
  AttachmentInput,
  ChannelInput,
  MessageInput,
  RecentMessage,
  ScopeState,
  ScopeTypeValue,
  SearchFilters,
  SearchHit,
  SourceTypeValue,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Writes (embedding-worker is the only caller)
// ─────────────────────────────────────────────────────────────────────────────

/** Upsert a channel/thread. Called by the bot during backfill enumeration
 * (channels + indexing_state are crawl bookkeeping owned by the bot). */
export async function upsertChannel(c: ChannelInput): Promise<void> {
  await pool.query(
    `INSERT INTO channels (channel_id, guild_id, parent_id, name, type, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (channel_id) DO UPDATE SET
       guild_id = EXCLUDED.guild_id, parent_id = EXCLUDED.parent_id,
       name = EXCLUDED.name, type = EXCLUDED.type, updated_at = now()`,
    [c.channelId, c.guildId, c.parentId, c.name, c.type],
  );
}

export async function upsertMessage(
  client: DbClient,
  m: MessageInput,
  contentHash: string,
): Promise<void> {
  await client.query(
    `INSERT INTO messages
       (message_id, guild_id, channel_id, thread_id, author_id, author_name, ts, content, content_hash, deleted, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, now())
     ON CONFLICT (message_id) DO UPDATE SET
       guild_id = EXCLUDED.guild_id, channel_id = EXCLUDED.channel_id, thread_id = EXCLUDED.thread_id,
       author_id = EXCLUDED.author_id, author_name = EXCLUDED.author_name, ts = EXCLUDED.ts,
       content = EXCLUDED.content, content_hash = EXCLUDED.content_hash, deleted = false, updated_at = now()`,
    [
      m.messageId,
      m.guildId,
      m.channelId,
      m.threadId,
      m.authorId,
      m.authorName,
      m.ts,
      m.content,
      contentHash,
    ],
  );
}

/** Tombstone a message (kept for history; filtered out of all search results). */
export async function markMessageDeleted(messageId: string): Promise<void> {
  await pool.query("UPDATE messages SET deleted = true, updated_at = now() WHERE message_id = $1", [
    messageId,
  ]);
}

/** Tombstone every message in a channel/thread (e.g. when it is deleted). */
export async function markChannelMessagesDeleted(channelId: string): Promise<number> {
  const res = await pool.query(
    "UPDATE messages SET deleted = true, updated_at = now() WHERE channel_id = $1 AND NOT deleted",
    [channelId],
  );
  return res.rowCount ?? 0;
}

export interface AttachmentRecord extends AttachmentInput {
  messageId: string;
  content: string | null;
  contentHash: string | null;
  extractStatus: number;
}

export async function upsertAttachment(client: DbClient, a: AttachmentRecord): Promise<void> {
  await client.query(
    `INSERT INTO attachments
       (attachment_id, message_id, filename, content_type, size_bytes, content, content_hash, extract_status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (attachment_id) DO UPDATE SET
       message_id = EXCLUDED.message_id, filename = EXCLUDED.filename, content_type = EXCLUDED.content_type,
       size_bytes = EXCLUDED.size_bytes, content = EXCLUDED.content, content_hash = EXCLUDED.content_hash,
       extract_status = EXCLUDED.extract_status, updated_at = now()`,
    [
      a.attachmentId,
      a.messageId,
      a.filename,
      a.contentType,
      a.size,
      a.content,
      a.contentHash,
      a.extractStatus,
    ],
  );
}

/** Read the existing (content_hash, model) for a source's embeddings, if any.
 * Lets the worker skip re-embedding unchanged content. */
export async function getEmbeddingState(
  sourceType: SourceTypeValue,
  sourceId: string,
): Promise<{ contentHash: string; model: string } | null> {
  const { rows } = await pool.query<{ content_hash: string; model: string }>(
    "SELECT content_hash, model FROM embeddings WHERE source_type = $1 AND source_id = $2 LIMIT 1",
    [sourceType, sourceId],
  );
  const row = rows[0];
  return row ? { contentHash: row.content_hash, model: row.model } : null;
}

export interface Chunk {
  text: string;
  embedding: number[];
}

/** Replace all embedding rows for a source (delete-then-insert in one transaction).
 * Cleanly handles edits that add OR remove chunks. */
export async function replaceEmbeddings(
  client: DbClient,
  sourceType: SourceTypeValue,
  sourceId: string,
  messageId: string,
  chunks: Chunk[],
  model: string,
  dim: number,
  contentHash: string,
): Promise<void> {
  await client.query("DELETE FROM embeddings WHERE source_type = $1 AND source_id = $2", [
    sourceType,
    sourceId,
  ]);
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk) continue;
    await client.query(
      `INSERT INTO embeddings
         (source_type, source_id, chunk_index, message_id, chunk_text, embedding, model, dim, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8, $9)`,
      [
        sourceType,
        sourceId,
        i,
        messageId,
        chunk.text,
        toVectorLiteral(chunk.embedding),
        model,
        dim,
        contentHash,
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Indexing-state checkpoints
// ─────────────────────────────────────────────────────────────────────────────

export async function upsertScope(
  scopeId: string,
  scopeType: ScopeTypeValue,
  guildId: string,
  parentId: string | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO indexing_state (scope_id, scope_type, guild_id, parent_id, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (scope_id) DO UPDATE SET
       scope_type = EXCLUDED.scope_type, guild_id = EXCLUDED.guild_id,
       parent_id = EXCLUDED.parent_id, updated_at = now()`,
    [scopeId, scopeType, guildId, parentId],
  );
}

export async function getScope(scopeId: string): Promise<ScopeState | null> {
  const { rows } = await pool.query<ScopeRow>("SELECT * FROM indexing_state WHERE scope_id = $1", [
    scopeId,
  ]);
  const row = rows[0];
  return row ? mapScope(row) : null;
}

export interface ScopePatch {
  oldestSeenId?: string | null;
  newestSeenId?: string | null;
  backfillDone?: boolean;
  archivedDone?: boolean;
  lastError?: string | null;
}

/** Patch a scope's checkpoint. Undefined fields are preserved (COALESCE);
 * lastError is always written (pass null to clear). */
export async function updateScope(scopeId: string, patch: ScopePatch): Promise<void> {
  await pool.query(
    `UPDATE indexing_state SET
       oldest_seen_id = COALESCE($2, oldest_seen_id),
       newest_seen_id = COALESCE($3, newest_seen_id),
       backfill_done  = COALESCE($4, backfill_done),
       archived_done  = COALESCE($5, archived_done),
       last_error     = $6,
       updated_at = now()
     WHERE scope_id = $1`,
    [
      scopeId,
      patch.oldestSeenId ?? null,
      patch.newestSeenId ?? null,
      patch.backfillDone ?? null,
      patch.archivedDone ?? null,
      patch.lastError ?? null,
    ],
  );
}

interface ScopeRow {
  scope_id: string;
  scope_type: number;
  guild_id: string;
  parent_id: string | null;
  oldest_seen_id: string | null;
  newest_seen_id: string | null;
  backfill_done: boolean;
  archived_done: boolean;
  last_error: string | null;
}

function mapScope(r: ScopeRow): ScopeState {
  return {
    scopeId: r.scope_id,
    scopeType: r.scope_type as ScopeTypeValue,
    guildId: r.guild_id,
    parentId: r.parent_id,
    oldestSeenId: r.oldest_seen_id,
    newestSeenId: r.newest_seen_id,
    backfillDone: r.backfill_done,
    archivedDone: r.archived_done,
    lastError: r.last_error,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────────────────────────

// Filter predicates shared by both search modes. They reference params $3–$8 so the
// parameter layout is identical between semantic and hybrid queries.
// $8 is the per-user access allow-list: keep a row if its channel is listed, or its
// parent channel is (threads inherit access from the parent they live under).
const FILTER_SQL = `
  AND ($3::bigint[] IS NULL OR m.guild_id = ANY($3::bigint[]))
  AND ($4::bigint IS NULL OR m.channel_id = $4::bigint)
  AND ($5::bigint IS NULL OR m.author_id = $5::bigint)
  AND ($6::timestamptz IS NULL OR m.ts >= $6::timestamptz)
  AND ($7::timestamptz IS NULL OR m.ts <= $7::timestamptz)
  AND ($8::bigint[] IS NULL OR m.channel_id = ANY($8::bigint[])
       OR EXISTS (SELECT 1 FROM channels ch
                  WHERE ch.channel_id = m.channel_id AND ch.parent_id = ANY($8::bigint[])))`;

interface HitRow {
  message_id: string;
  guild_id: string;
  channel_id: string;
  channel_name: string | null;
  thread_id: string | null;
  author_id: string;
  author_name: string;
  ts: Date | string;
  content: string;
  chunk_text: string | null;
  score: number | string;
}

function mapHit(r: HitRow): SearchHit {
  return {
    messageId: r.message_id,
    guildId: r.guild_id,
    channelId: r.channel_id,
    channelName: r.channel_name,
    threadId: r.thread_id,
    authorId: r.author_id,
    authorName: r.author_name,
    ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts),
    content: r.content,
    chunkText: r.chunk_text ?? r.content,
    score: Number(r.score),
  };
}

function filterParams(filters: SearchFilters): unknown[] {
  return [
    filters.guildIds && filters.guildIds.length > 0 ? filters.guildIds : null,
    filters.channelId ?? null,
    filters.authorId ?? null,
    filters.after ?? null,
    filters.before ?? null,
    // null = no access restriction; [] (empty) = nothing visible to this user.
    filters.channelIds ?? null,
  ];
}

/** Pure vector search. Returns the single best chunk per message. */
export async function semanticSearch(
  queryEmbedding: number[],
  topN: number,
  filters: SearchFilters = {},
): Promise<SearchHit[]> {
  const k = topN * config.ANN_OVERSAMPLE;
  const vec = toVectorLiteral(queryEmbedding);
  const sql = `
    WITH ann AS (
      SELECT e.message_id, e.chunk_text, e.embedding <=> $1::vector AS dist
      FROM embeddings e
      JOIN messages m ON m.message_id = e.message_id
      WHERE NOT m.deleted ${FILTER_SQL}
      ORDER BY e.embedding <=> $1::vector
      LIMIT $2
    ),
    best AS (
      SELECT DISTINCT ON (message_id) message_id, chunk_text, dist
      FROM ann ORDER BY message_id, dist
    )
    SELECT m.message_id, m.guild_id, m.channel_id, c.name AS channel_name, m.thread_id,
           m.author_id, m.author_name, m.ts, m.content, b.chunk_text,
           (1.0 - b.dist) AS score
    FROM best b
    JOIN messages m ON m.message_id = b.message_id
    LEFT JOIN channels c ON c.channel_id = m.channel_id
    ORDER BY b.dist
    LIMIT $9`;

  return withTransaction(async (client) => {
    await client.query(`SET LOCAL hnsw.ef_search = ${Number(config.HNSW_EF_SEARCH)}`);
    // $1 vec, $2 ANN limit, $3–$8 filters, $9 topN
    const { rows } = await client.query<HitRow>(sql, [vec, k, ...filterParams(filters), topN]);
    return rows.map(mapHit);
  });
}

/** Hybrid search via Reciprocal Rank Fusion of vector + full-text rankings. */
export async function hybridSearch(
  queryEmbedding: number[],
  queryText: string,
  topN: number,
  filters: SearchFilters = {},
): Promise<SearchHit[]> {
  const k = topN * config.ANN_OVERSAMPLE;
  const cap = Math.max(topN * 2, 30);
  const rrfK = 50;
  const vec = toVectorLiteral(queryEmbedding);
  const sql = `
    WITH semantic AS (
      SELECT message_id, ROW_NUMBER() OVER (ORDER BY dist) AS rank_ix
      FROM (
        SELECT DISTINCT ON (message_id) message_id, dist FROM (
          SELECT e.message_id, e.embedding <=> $1::vector AS dist
          FROM embeddings e
          JOIN messages m ON m.message_id = e.message_id
          WHERE NOT m.deleted ${FILTER_SQL}
          ORDER BY e.embedding <=> $1::vector
          LIMIT $2
        ) ann
        ORDER BY message_id, dist
      ) d
      ORDER BY dist
      LIMIT $13
    ),
    full_text AS (
      SELECT m.message_id,
             ROW_NUMBER() OVER (
               ORDER BY ts_rank_cd(m.fts, websearch_to_tsquery($10::regconfig, $11)) DESC
             ) AS rank_ix
      FROM messages m
      WHERE m.fts @@ websearch_to_tsquery($10::regconfig, $11) AND NOT m.deleted ${FILTER_SQL}
      ORDER BY rank_ix
      LIMIT $13
    )
    SELECT m.message_id, m.guild_id, m.channel_id, c.name AS channel_name, m.thread_id,
           m.author_id, m.author_name, m.ts, m.content, NULL::text AS chunk_text,
           COALESCE(1.0 / ($12 + s.rank_ix), 0.0) + COALESCE(1.0 / ($12 + ft.rank_ix), 0.0) AS score
    FROM full_text ft
    FULL OUTER JOIN semantic s USING (message_id)
    JOIN messages m ON m.message_id = COALESCE(ft.message_id, s.message_id)
    LEFT JOIN channels c ON c.channel_id = m.channel_id
    ORDER BY score DESC
    LIMIT $9`;

  return withTransaction(async (client) => {
    await client.query(`SET LOCAL hnsw.ef_search = ${Number(config.HNSW_EF_SEARCH)}`);
    const { rows } = await client.query<HitRow>(sql, [
      vec, // $1
      k, // $2
      ...filterParams(filters), // $3–$8 (filters incl. access allow-list)
      topN, // $9
      config.FTS_LANG, // $10
      queryText, // $11
      rrfK, // $12
      cap, // $13
    ]);
    return rows.map(mapHit);
  });
}

export interface RecentMessagesOptions {
  guildIds?: string[];
  channelId?: string; // restrict to one channel/thread
  channelIds?: string[]; // per-user access allow-list (with thread-parent inheritance)
  sinceIso?: string; // lower time bound
  limit: number;
}

/** Fetch non-empty messages in time order (oldest → newest) for summaries/digests.
 * Returns the most-recent `limit` messages within the window, in chronological order. */
export async function getRecentMessages(opts: RecentMessagesOptions): Promise<RecentMessage[]> {
  const sql = `
    SELECT m.message_id, m.channel_id, c.name AS channel_name, m.author_name, m.ts, m.content
    FROM messages m
    LEFT JOIN channels c ON c.channel_id = m.channel_id
    WHERE NOT m.deleted
      AND length(btrim(m.content)) > 0
      AND ($1::bigint[] IS NULL OR m.guild_id = ANY($1::bigint[]))
      AND ($2::bigint IS NULL OR m.channel_id = $2::bigint)
      AND ($3::timestamptz IS NULL OR m.ts >= $3::timestamptz)
      AND ($4::bigint[] IS NULL OR m.channel_id = ANY($4::bigint[])
           OR EXISTS (SELECT 1 FROM channels ch
                      WHERE ch.channel_id = m.channel_id AND ch.parent_id = ANY($4::bigint[])))
    ORDER BY m.ts DESC
    LIMIT $5`;
  const { rows } = await pool.query<{
    message_id: string;
    channel_id: string;
    channel_name: string | null;
    author_name: string;
    ts: Date | string;
    content: string;
  }>(sql, [
    opts.guildIds && opts.guildIds.length > 0 ? opts.guildIds : null,
    opts.channelId ?? null,
    opts.sinceIso ?? null,
    opts.channelIds ?? null,
    opts.limit,
  ]);
  return rows
    .map((r) => ({
      messageId: r.message_id,
      channelId: r.channel_id,
      channelName: r.channel_name,
      authorName: r.author_name,
      ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts),
      content: r.content,
    }))
    .reverse(); // chronological (oldest first) for transcript building
}
