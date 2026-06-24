-- 0004_settings.sql — runtime-adjustable settings (e.g. the active chat model,
-- set from Discord via /model). Falls back to env defaults when a key is absent.

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
