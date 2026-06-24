import { createHash } from "node:crypto";

/** Stable content hash used to skip re-embedding unchanged text and to key
 * queue deduplication so edits (new hash) are never collapsed into a stale job. */
export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
