/** In-memory per-user sliding-window rate limiter (one bot process handles all
 * interactions, so memory is fine; counters reset on restart). */
const hits = new Map<string, number[]>();
const WINDOW_MS = 3_600_000; // 1 hour

/** Returns true if under the limit (and records the hit). `key` is per-(guild,user).
 * 0 = unlimited. */
export function checkRate(key: string, perHour: number): boolean {
  if (perHour <= 0) return true;
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);
  if (recent.length >= perHour) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}
