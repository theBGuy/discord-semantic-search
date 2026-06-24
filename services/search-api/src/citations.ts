import { type Citation, messageUrl, type SearchHit } from "@app/shared";

/** Map the hits actually used for context into citations. The 1-based index matches the
 * `[n]` numbering the context builder gives the model (used[0] -> [1]). Shared by /ask
 * and /kb so the numbering stays consistent. */
export function toCitations(hits: SearchHit[]): Citation[] {
  return hits.map((h, i) => ({
    index: i + 1,
    channelName: h.channelName,
    authorName: h.authorName,
    timestamp: h.ts,
    url: messageUrl(h.guildId, h.channelId, h.messageId),
    preview: (h.chunkText || h.content).replace(/\s+/g, " ").trim().slice(0, 180),
  }));
}
