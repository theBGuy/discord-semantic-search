-- 0005_governance.sql — access-control lists for bot governance.
-- kind: 'admin' (user id), 'allow_role' (role id), 'allow_user' (user id).
-- Scalar policy (access_mode, rate_per_hour) lives in the `settings` table.

CREATE TABLE IF NOT EXISTS acl (
  kind       TEXT   NOT NULL,
  subject_id BIGINT NOT NULL,
  added_by   BIGINT,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, subject_id)
);
