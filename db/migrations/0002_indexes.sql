-- 0002_indexes.sql — filter/join indexes, full-text GIN, and the HNSW ANN index.

-- Filters / joins
CREATE INDEX IF NOT EXISTS idx_messages_guild_channel_ts ON messages (guild_id, channel_id, ts);
CREATE INDEX IF NOT EXISTS idx_messages_ts               ON messages (ts);
CREATE INDEX IF NOT EXISTS idx_messages_author           ON messages (author_id);
CREATE INDEX IF NOT EXISTS idx_emb_message               ON embeddings (message_id);

-- Full-text search (hybrid). Must match the language of messages.fts (english).
CREATE INDEX IF NOT EXISTS idx_messages_fts ON messages USING GIN (fts);

-- Approximate-nearest-neighbour vector index. HNSW builds incrementally on an empty
-- table and grows with streaming inserts, which fits live Discord ingest. Cosine
-- distance (<=>) is used consistently everywhere; an ANN index only accelerates the
-- operator class it was built with.
CREATE INDEX IF NOT EXISTS idx_emb_hnsw
  ON embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
