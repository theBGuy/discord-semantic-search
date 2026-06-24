import { config } from "./config";
import { pool } from "./db";

export async function getSetting(key: string): Promise<string | null> {
  const { rows } = await pool.query<{ value: string }>(
    "SELECT value FROM settings WHERE key = $1",
    [key],
  );
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value],
  );
}

/** The active primary chat model (used on the cloud endpoint, or local if no cloud). */
export async function getChatModel(): Promise<string> {
  return (await getSetting("chat_model")) ?? config.CHAT_MODEL;
}

export async function setChatModel(model: string): Promise<void> {
  await setSetting("chat_model", model);
}

/** The fallback chat model, used when chat falls back to the local endpoint.
 * Defaults to the primary model when neither a setting nor CHAT_MODEL_LOCAL is set. */
export async function getLocalChatModel(): Promise<string> {
  const s = await getSetting("chat_model_local");
  if (s) return s;
  if (config.CHAT_MODEL_LOCAL) return config.CHAT_MODEL_LOCAL;
  return getChatModel();
}

export async function setLocalChatModel(model: string): Promise<void> {
  await setSetting("chat_model_local", model);
}
