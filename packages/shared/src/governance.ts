import { bootstrapAdminIds, config } from "./config";
import { pool } from "./db";

export type AccessMode = "open" | "allowlist";
type AclKind = "admin" | "allow_role" | "allow_user";

// ── Per-guild scalar policy ──────────────────────────────────────────────────

async function getGuildSetting(guildId: string, key: string): Promise<string | null> {
  const { rows } = await pool.query<{ value: string }>(
    "SELECT value FROM guild_settings WHERE guild_id = $1 AND key = $2",
    [guildId, key],
  );
  return rows[0]?.value ?? null;
}

async function setGuildSetting(guildId: string, key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO guild_settings (guild_id, key, value, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (guild_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [guildId, key, value],
  );
}

// ── Per-guild ACL ────────────────────────────────────────────────────────────

async function listAcl(guildId: string, kind: AclKind): Promise<string[]> {
  const { rows } = await pool.query<{ subject_id: string }>(
    "SELECT subject_id FROM acl WHERE guild_id = $1 AND kind = $2 ORDER BY subject_id",
    [guildId, kind],
  );
  return rows.map((r) => r.subject_id);
}

async function addAclRow(
  guildId: string,
  kind: AclKind,
  subjectId: string,
  addedBy: string | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO acl (guild_id, kind, subject_id, added_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id, kind, subject_id) DO NOTHING`,
    [guildId, kind, subjectId, addedBy],
  );
}

async function removeAclRow(guildId: string, kind: AclKind, subjectId: string): Promise<void> {
  await pool.query("DELETE FROM acl WHERE guild_id = $1 AND kind = $2 AND subject_id = $3", [
    guildId,
    kind,
    subjectId,
  ]);
}

// ── Admins (env super-admins are global; DB admins are per-guild) ─────────────

/** Global operator — admin in every guild, only one who can change global settings. */
export const isSuperAdmin = (userId: string): boolean => bootstrapAdminIds.has(userId);

export async function isAdmin(guildId: string, userId: string): Promise<boolean> {
  if (bootstrapAdminIds.has(userId)) return true;
  const { rows } = await pool.query(
    "SELECT 1 FROM acl WHERE guild_id = $1 AND kind = 'admin' AND subject_id = $2",
    [guildId, userId],
  );
  return rows.length > 0;
}

/** Whether this guild has its own (DB) admin — gates the Manage-Server bootstrap. */
export async function hasGuildAdmin(guildId: string): Promise<boolean> {
  const { rows } = await pool.query(
    "SELECT 1 FROM acl WHERE guild_id = $1 AND kind = 'admin' LIMIT 1",
    [guildId],
  );
  return rows.length > 0;
}

export async function listAdmins(
  guildId: string,
): Promise<{ superIds: string[]; guildIds: string[] }> {
  return { superIds: [...bootstrapAdminIds], guildIds: await listAcl(guildId, "admin") };
}

export const addAdmin = (guildId: string, userId: string, by: string) =>
  addAclRow(guildId, "admin", userId, by);
export const removeAdmin = (guildId: string, userId: string) =>
  removeAclRow(guildId, "admin", userId);

// ── Access mode + allowlist (per guild) ──────────────────────────────────────

export async function getAccessMode(guildId: string): Promise<AccessMode> {
  return (await getGuildSetting(guildId, "access_mode")) === "open" ? "open" : "allowlist";
}

export const setAccessMode = (guildId: string, mode: AccessMode) =>
  setGuildSetting(guildId, "access_mode", mode);

/** Allowlist check (does NOT consider admin status — callers short-circuit admins). */
export async function isAllowed(
  guildId: string,
  userId: string,
  roleIds: string[],
): Promise<boolean> {
  const [users, roles] = await Promise.all([
    listAcl(guildId, "allow_user"),
    listAcl(guildId, "allow_role"),
  ]);
  if (users.includes(userId)) return true;
  const roleSet = new Set(roles);
  return roleIds.some((r) => roleSet.has(r));
}

export const listAllowedUsers = (guildId: string) => listAcl(guildId, "allow_user");
export const listAllowedRoles = (guildId: string) => listAcl(guildId, "allow_role");
export const allowUser = (guildId: string, id: string, by: string) =>
  addAclRow(guildId, "allow_user", id, by);
export const allowRole = (guildId: string, id: string, by: string) =>
  addAclRow(guildId, "allow_role", id, by);
export const disallowUser = (guildId: string, id: string) =>
  removeAclRow(guildId, "allow_user", id);
export const disallowRole = (guildId: string, id: string) =>
  removeAclRow(guildId, "allow_role", id);

// ── Rate limit (per guild; the per-user counter lives in the bot) ────────────

export async function getRateLimitPerHour(guildId: string): Promise<number> {
  const s = await getGuildSetting(guildId, "rate_per_hour");
  return s !== null ? Number(s) : config.RATE_LIMIT_PER_HOUR;
}

export const setRateLimitPerHour = (guildId: string, n: number) =>
  setGuildSetting(guildId, "rate_per_hour", String(n));
