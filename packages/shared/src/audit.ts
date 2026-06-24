import { pool } from "./db";
import { logger } from "./logger";

export type AuditOutcome = "ok" | "denied";

/** A governance action (or denial) to append to a guild's audit trail. */
export interface AuditEntry {
  guildId: string;
  actorId: string;
  action: string;
  targetId?: string | null;
  detail?: string | null;
  outcome?: AuditOutcome;
}

/** A stored audit row, ready to render. `ts` is a JS Date (timestamptz). */
export interface AuditRow {
  id: string;
  ts: Date;
  actorId: string;
  action: string;
  targetId: string | null;
  detail: string | null;
  outcome: AuditOutcome;
}

/** Append an audit entry. Best-effort: failures are logged, never thrown — recording
 * a governance action must never break the action itself. */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_log (guild_id, actor_id, action, target_id, detail, outcome)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        entry.guildId,
        entry.actorId,
        entry.action,
        entry.targetId ?? null,
        entry.detail ?? null,
        entry.outcome ?? "ok",
      ],
    );
  } catch (err) {
    logger.error({ err, action: entry.action }, "failed to write audit log");
  }
}

/** Most-recent audit entries for a guild, newest first. */
export async function listAudit(guildId: string, limit = 20): Promise<AuditRow[]> {
  const { rows } = await pool.query<{
    id: string;
    ts: Date;
    actor_id: string;
    action: string;
    target_id: string | null;
    detail: string | null;
    outcome: string;
  }>(
    `SELECT id, ts, actor_id, action, target_id, detail, outcome
       FROM audit_log
      WHERE guild_id = $1
      ORDER BY ts DESC, id DESC
      LIMIT $2`,
    [guildId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    actorId: r.actor_id,
    action: r.action,
    targetId: r.target_id,
    detail: r.detail,
    outcome: r.outcome === "denied" ? "denied" : "ok",
  }));
}
