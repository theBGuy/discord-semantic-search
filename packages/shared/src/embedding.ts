import { config, EMBED_DOC_PREFIX } from "./config";
import { embed } from "./ollama";
import type { Chunk } from "./repo";

/** Embed chunk texts (with the document prefix) and assert each vector's dimension
 * matches the configured EMBED_DIM. A mismatch is a fatal configuration error (throws),
 * not a retryable one — it means EMBED_MODEL/EMBED_DIM or the VECTOR column disagree.
 *
 * Shared by the live worker and the `reembed` path so both get the same guard. */
export async function embedChunks(texts: string[]): Promise<Chunk[]> {
  if (texts.length === 0) return [];
  const vectors = await embed(texts.map((t) => EMBED_DOC_PREFIX + t));
  return texts.map((text, i) => {
    const embedding = vectors[i];
    if (!embedding) throw new Error(`missing embedding for chunk ${i}`);
    if (embedding.length !== config.EMBED_DIM) {
      throw new Error(
        `embedding dim ${embedding.length} != EMBED_DIM ${config.EMBED_DIM} ` +
          `(model ${config.EMBED_MODEL}) — check EMBED_MODEL/EMBED_DIM and the VECTOR column`,
      );
    }
    return { text, embedding };
  });
}
