import { config } from "./config";

/**
 * Deterministic, char-based chunker. Discord messages are short (so usually one
 * chunk), but long messages and extracted attachment text must be split to stay
 * comfortably under the embedding model's context window. We split on paragraph /
 * whitespace boundaries when possible and apply a fixed overlap so meaning that
 * straddles a boundary is still captured.
 *
 * Char-based (≈4 chars/token) is intentional: it needs no tokenizer dependency and,
 * with conservative defaults (~1800 chars ≈ 450 tokens), stays well under
 * nomic-embed-text's served context.
 */
export function chunkText(
  text: string,
  maxChars = config.CHUNK_MAX_CHARS,
  overlapChars = config.CHUNK_OVERLAP_CHARS,
): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const overlap = Math.min(overlapChars, Math.floor(maxChars / 2));
  const chunks: string[] = [];
  let start = 0;

  while (start < trimmed.length) {
    let end = Math.min(start + maxChars, trimmed.length);

    // Prefer to break on a whitespace boundary near the window end (avoid mid-word cuts).
    if (end < trimmed.length) {
      const slice = trimmed.slice(start, end);
      const lastBreak = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
      if (lastBreak > maxChars * 0.5) {
        end = start + lastBreak + 1;
      }
    }

    chunks.push(trimmed.slice(start, end).trim());
    if (end >= trimmed.length) break;
    start = Math.max(end - overlap, start + 1);
  }

  return chunks.filter((c) => c.length > 0);
}
