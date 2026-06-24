import { pool } from "./db";
import { QUEUE_ATTACHMENT, QUEUE_DLQ, QUEUE_MESSAGE } from "./queue";

function guildArg(guildIds?: string[]): string[] | null {
  return guildIds && guildIds.length > 0 ? guildIds : null;
}

export interface IndexStats {
  messages: number;
  embeddings: number;
  attachments: number;
  channels: number;
}

/** Indexed-content counts, optionally scoped to specific guilds. */
export async function getIndexStats(guildIds?: string[]): Promise<IndexStats> {
  const g = guildArg(guildIds);
  const { rows } = await pool.query<IndexStats>(
    `SELECT
       (SELECT count(*) FROM messages m
         WHERE NOT m.deleted AND ($1::bigint[] IS NULL OR m.guild_id = ANY($1::bigint[])))::int AS messages,
       (SELECT count(*) FROM embeddings e JOIN messages m ON m.message_id = e.message_id
         WHERE NOT m.deleted AND ($1::bigint[] IS NULL OR m.guild_id = ANY($1::bigint[])))::int AS embeddings,
       (SELECT count(*) FROM attachments a JOIN messages m ON m.message_id = a.message_id
         WHERE ($1::bigint[] IS NULL OR m.guild_id = ANY($1::bigint[])))::int AS attachments,
       (SELECT count(*) FROM channels c
         WHERE ($1::bigint[] IS NULL OR c.guild_id = ANY($1::bigint[])))::int AS channels`,
    [g],
  );
  return rows[0] ?? { messages: 0, embeddings: 0, attachments: 0, channels: 0 };
}

export interface BackfillStats {
  scopes: number;
  done: number;
  inProgress: number;
  errored: number;
  /** ISO timestamp of the newest indexed message, or null. */
  newestTs: string | null;
}

export async function getBackfillStats(guildIds?: string[]): Promise<BackfillStats> {
  const g = guildArg(guildIds);
  const { rows } = await pool.query<{
    scopes: number;
    done: number;
    in_progress: number;
    errored: number;
    newest_ts: Date | null;
  }>(
    `SELECT
       count(*)::int AS scopes,
       count(*) FILTER (WHERE backfill_done)::int AS done,
       count(*) FILTER (WHERE NOT backfill_done)::int AS in_progress,
       count(*) FILTER (WHERE last_error IS NOT NULL)::int AS errored,
       (SELECT max(ts) FROM messages m
         WHERE NOT m.deleted AND ($1::bigint[] IS NULL OR m.guild_id = ANY($1::bigint[]))) AS newest_ts
     FROM indexing_state
     WHERE ($1::bigint[] IS NULL OR guild_id = ANY($1::bigint[]))`,
    [g],
  );
  const r = rows[0];
  return {
    scopes: r?.scopes ?? 0,
    done: r?.done ?? 0,
    inProgress: r?.in_progress ?? 0,
    errored: r?.errored ?? 0,
    newestTs: r?.newest_ts ? new Date(r.newest_ts).toISOString() : null,
  };
}

export interface QueueStats {
  pending: number; // created + retry + active in the embed queues
  active: number;
  deadLetter: number;
  available: boolean; // false if the pg-boss schema isn't present yet
}

export async function getQueueStats(): Promise<QueueStats> {
  try {
    const { rows } = await pool.query<{ name: string; state: string; n: number }>(
      `SELECT name, state, count(*)::int AS n FROM pgboss.job
       WHERE name = ANY($1) GROUP BY name, state`,
      [[QUEUE_MESSAGE, QUEUE_ATTACHMENT, QUEUE_DLQ]],
    );
    let pending = 0;
    let active = 0;
    let deadLetter = 0;
    for (const row of rows) {
      if (row.name === QUEUE_DLQ) {
        deadLetter += row.n;
        continue;
      }
      if (row.state === "active") active += row.n;
      if (row.state === "created" || row.state === "retry" || row.state === "active") {
        pending += row.n;
      }
    }
    return { pending, active, deadLetter, available: true };
  } catch {
    return { pending: 0, active: 0, deadLetter: 0, available: false };
  }
}

/** Distinct (model, dim) pairs present in the embeddings corpus — for drift detection. */
export async function getCorpusModels(): Promise<{ model: string; dim: number }[]> {
  const { rows } = await pool.query<{ model: string; dim: number }>(
    "SELECT DISTINCT model, dim FROM embeddings LIMIT 10",
  );
  return rows;
}
