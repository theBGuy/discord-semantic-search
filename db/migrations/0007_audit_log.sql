-- 0007_audit_log.sql — per-server audit trail of governance actions + denials.
-- Records who changed governance (add/remove admin, access mode, allow/disallow,
-- rate limit) and who was denied a command, viewable per guild via /admin log.

CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  guild_id   BIGINT      NOT NULL,
  ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id   BIGINT      NOT NULL,   -- who took the action (or was denied)
  action     TEXT        NOT NULL,   -- 'admin.add' | 'admin.remove' | 'access' | 'allow' | 'disallow' | 'ratelimit' | 'denied'
  target_id  BIGINT,                 -- subject of the action (user/role) when there is a single one
  detail     TEXT,                   -- display-ready context (mode value, mentions, denied command)
  outcome    TEXT        NOT NULL DEFAULT 'ok'  -- 'ok' | 'denied'
);

CREATE INDEX IF NOT EXISTS idx_audit_guild_ts ON audit_log (guild_id, ts DESC);
