-- 0006_per_guild_governance.sql — scope governance to each guild.
-- The previous (global) acl from 0005 is replaced; re-add admins/allowlist per guild
-- (env BOOTSTRAP_ADMIN_IDS super-admins are unaffected). Scalar per-guild policy
-- (access_mode, rate_per_hour) lives in guild_settings.

DROP TABLE IF EXISTS acl;

CREATE TABLE acl (
  guild_id   BIGINT NOT NULL,
  kind       TEXT   NOT NULL,   -- 'admin' | 'allow_role' | 'allow_user'
  subject_id BIGINT NOT NULL,
  added_by   BIGINT,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, kind, subject_id)
);

CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id   BIGINT NOT NULL,
  key        TEXT   NOT NULL,   -- 'access_mode' | 'rate_per_hour'
  value      TEXT   NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, key)
);
