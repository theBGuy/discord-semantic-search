-- 0003_attachments.sql — Phase 2: attachment text extraction.
-- Extracted text is stored here (NOT merged into messages.content, whose generated
-- tsvector has a ~1 MB size cap). Attachment chunks are embedded into the shared
-- `embeddings` table with source_type = 1, source_id = attachment_id.

CREATE TABLE IF NOT EXISTS attachments (
  attachment_id  BIGINT PRIMARY KEY,
  message_id     BIGINT NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
  filename       TEXT NOT NULL,
  content_type   TEXT,
  size_bytes     BIGINT,
  content        TEXT,                       -- extracted text (NULL if unsupported / too large / failed)
  content_hash   TEXT,
  extract_status SMALLINT NOT NULL DEFAULT 0,-- 0=pending, 1=ok, 2=skipped, 3=failed
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments (message_id);
