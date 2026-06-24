import { chunkText } from "./chunk";
import { config } from "./config";
import { pool, withTransaction } from "./db";
import { embedChunks } from "./embedding";
import { logger } from "./logger";
import { replaceEmbeddings } from "./repo";
import { SourceType, type SourceTypeValue } from "./types";

/** Current dimension of the embeddings.embedding column, or null if not yet set. */
export async function currentEmbeddingDimension(): Promise<number | null> {
  const { rows } = await pool.query<{ type: string }>(
    `SELECT format_type(atttypid, atttypmod) AS type
     FROM pg_attribute
     WHERE attrelid = 'embeddings'::regclass AND attname = 'embedding' AND NOT attisdropped`,
  );
  const m = rows[0]?.type?.match(/vector\((\d+)\)/);
  return m ? Number(m[1]) : null;
}

/** Drop the ANN index, wipe embeddings, set the column to `dim`, recreate the index. */
export async function reprovisionEmbeddingColumn(dim: number): Promise<void> {
  await pool.query("DROP INDEX IF EXISTS idx_emb_hnsw");
  await pool.query("TRUNCATE embeddings");
  // `dim` is a validated positive integer from config — safe to interpolate.
  await pool.query(`ALTER TABLE embeddings ALTER COLUMN embedding TYPE vector(${dim})`);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_emb_hnsw ON embeddings
       USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`,
  );
}

/** Called by migrate: align the column to EMBED_DIM. Safe to auto-apply when empty;
 * never destroys data — if data exists at a different dim, warn and point to reembed. */
export async function ensureEmbeddingDimension(targetDim: number): Promise<void> {
  const cur = await currentEmbeddingDimension();
  if (cur === targetDim) return;
  const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM embeddings");
  const n = rows[0]?.n ?? 0;
  if (n === 0) {
    logger.warn({ cur, targetDim }, "embeddings empty — setting vector column to EMBED_DIM");
    await reprovisionEmbeddingColumn(targetDim);
  } else {
    logger.warn(
      { cur, targetDim, count: n },
      "EMBED_DIM differs from the embeddings column with data present — run `pnpm reembed` to re-embed at the new dimension (embedding writes will fail until then)",
    );
  }
}

async function embedAndStore(
  sourceType: SourceTypeValue,
  sourceId: string,
  messageId: string,
  text: string,
  contentHash: string,
): Promise<number> {
  const texts = chunkText(text).slice(0, config.MAX_CHUNKS_PER_JOB);
  const chunks = await embedChunks(texts);
  if (chunks.length === 0) return 0;
  await withTransaction((client) =>
    replaceEmbeddings(
      client,
      sourceType,
      sourceId,
      messageId,
      chunks,
      config.EMBED_MODEL,
      config.EMBED_DIM,
      contentHash,
    ),
  );
  return chunks.length;
}

/**
 * Re-embed all stored message + attachment text at the configured model/dimension —
 * no Discord re-crawl, no re-OCR. Reprovisions the column first. Idempotent.
 */
export async function reembedAll(): Promise<{
  messages: number;
  attachments: number;
  chunks: number;
}> {
  await reprovisionEmbeddingColumn(config.EMBED_DIM);

  let messages = 0;
  let attachments = 0;
  let chunks = 0;

  let after = "0";
  while (true) {
    const { rows } = await pool.query<{
      message_id: string;
      content: string;
      content_hash: string;
    }>(
      `SELECT message_id, content, content_hash FROM messages
       WHERE NOT deleted AND length(btrim(content)) > 0 AND message_id > $1
       ORDER BY message_id LIMIT 200`,
      [after],
    );
    if (rows.length === 0) break;
    for (const r of rows) {
      chunks += await embedAndStore(
        SourceType.Message,
        r.message_id,
        r.message_id,
        r.content,
        r.content_hash,
      );
      messages++;
    }
    after = rows[rows.length - 1]?.message_id ?? after;
    if (messages % 500 === 0) logger.info({ messages, chunks }, "reembed: messages progress");
  }

  after = "0";
  while (true) {
    const { rows } = await pool.query<{
      attachment_id: string;
      message_id: string;
      content: string;
      content_hash: string | null;
    }>(
      `SELECT attachment_id, message_id, content, content_hash FROM attachments
       WHERE content IS NOT NULL AND length(btrim(content)) > 0 AND attachment_id > $1
       ORDER BY attachment_id LIMIT 200`,
      [after],
    );
    if (rows.length === 0) break;
    for (const r of rows) {
      chunks += await embedAndStore(
        SourceType.Attachment,
        r.attachment_id,
        r.message_id,
        r.content,
        r.content_hash ?? "",
      );
      attachments++;
    }
    after = rows[rows.length - 1]?.attachment_id ?? after;
  }

  return { messages, attachments, chunks };
}
