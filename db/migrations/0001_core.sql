-- 0001_core.sql — extension + core tables.
-- All statements are idempotent (IF NOT EXISTS) so re-running is safe.

CREATE EXTENSION IF NOT EXISTS vector;

-- Channels (and threads / forum posts, distinguished by parent_id + type).
CREATE TABLE IF NOT EXISTS channels (
  channel_id BIGINT PRIMARY KEY,
  guild_id   BIGINT NOT NULL,
  parent_id  BIGINT,                       -- NULL for top-level; set for threads / forum posts
  name       TEXT,
  type       SMALLINT,                     -- discord channel type
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Messages. Snowflake IDs are stored as BIGINT and handled as strings in JS.
CREATE TABLE IF NOT EXISTS messages (
  message_id   BIGINT PRIMARY KEY,
  guild_id     BIGINT NOT NULL,
  channel_id   BIGINT NOT NULL,
  thread_id    BIGINT,                      -- NULL when not in a thread
  author_id    BIGINT NOT NULL,
  author_name  TEXT NOT NULL,
  ts           TIMESTAMPTZ NOT NULL,        -- message timestamp ("timestamp" is a keyword; renamed)
  content      TEXT NOT NULL,
  content_hash TEXT NOT NULL,               -- sha256(content): skip re-embed when unchanged
  deleted      BOOLEAN NOT NULL DEFAULT false,  -- tombstone (filtered out of search)
  fts          tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Generalized chunk-level embeddings — one row per chunk; supports messages AND attachments.
--   source_type: 0 = message    (source_id = message_id)
--                1 = attachment  (source_id = attachment_id)
-- message_id is denormalized on every row so search joins back to message metadata + builds
-- the citation URL without a second lookup. PK is the idempotency anchor (UPSERT target).
CREATE TABLE IF NOT EXISTS embeddings (
  source_type  SMALLINT NOT NULL,
  source_id    BIGINT   NOT NULL,
  chunk_index  INT      NOT NULL,
  message_id   BIGINT   NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
  chunk_text   TEXT     NOT NULL,
  embedding    VECTOR(768) NOT NULL,
  model        TEXT     NOT NULL,           -- e.g. 'nomic-embed-text' (drift detection)
  dim          INT      NOT NULL,           -- e.g. 768
  content_hash TEXT     NOT NULL,           -- hash of source at embed time
  PRIMARY KEY (source_type, source_id, chunk_index)
);

-- Per-scope crawl checkpoints. A "scope" is a channel OR a thread (uniform crawl unit).
CREATE TABLE IF NOT EXISTS indexing_state (
  scope_id       BIGINT PRIMARY KEY,        -- channel_id OR thread_id
  scope_type     SMALLINT NOT NULL,         -- 0 = channel, 1 = thread
  guild_id       BIGINT NOT NULL,
  parent_id      BIGINT,
  oldest_seen_id BIGINT,                    -- backward backfill cursor (resume point)
  newest_seen_id BIGINT,                    -- forward high-watermark (offline catch-up)
  backfill_done  BOOLEAN NOT NULL DEFAULT false,
  archived_done  BOOLEAN NOT NULL DEFAULT false,
  last_error     TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
