import {
  type AttachmentRecord,
  chunkText,
  config,
  type DbClient,
  type EmbedAttachmentJob,
  type EmbedMessageJob,
  ExtractStatus,
  embedChunks,
  extract,
  getEmbeddingState,
  isImageAttachment,
  logger,
  replaceEmbeddings,
  SourceType,
  type SourceTypeValue,
  sha256,
  upsertAttachment,
  upsertMessage,
  withTransaction,
} from "@app/shared";
import { ocrExtract } from "./ocr";

/** Has this source already been embedded with the same content + model? */
async function alreadyEmbedded(
  sourceType: SourceTypeValue,
  sourceId: string,
  contentHash: string,
): Promise<boolean> {
  const existing = await getEmbeddingState(sourceType, sourceId);
  return (
    existing !== null &&
    existing.contentHash === contentHash &&
    existing.model === config.EMBED_MODEL
  );
}

export async function processMessageJob(job: EmbedMessageJob): Promise<void> {
  const { message } = job;
  const contentHash = sha256(message.content);

  if (await alreadyEmbedded(SourceType.Message, message.messageId, contentHash)) {
    // Unchanged: refresh metadata only (author name / channel may have changed).
    await withTransaction((client) => upsertMessage(client, message, contentHash));
    return;
  }

  const chunks = chunkText(message.content).slice(0, config.MAX_CHUNKS_PER_JOB);
  const embedded = await embedChunks(chunks);

  await withTransaction(async (client: DbClient) => {
    await upsertMessage(client, message, contentHash);
    await replaceEmbeddings(
      client,
      SourceType.Message,
      message.messageId,
      message.messageId,
      embedded,
      config.EMBED_MODEL,
      config.EMBED_DIM,
      contentHash,
    );
  });
  logger.debug({ messageId: message.messageId, chunks: embedded.length }, "embedded message");
}

interface Downloaded {
  buffer: Buffer | null;
  /** true when the failure is permanent (expired URL / not found) — do not retry. */
  permanentFailure: boolean;
}

async function download(url: string, maxBytes: number): Promise<Downloaded> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.ATTACHMENT_DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      // 401/403/404 typically mean an expired/revoked signed CDN URL — not retryable here.
      const permanent = res.status === 401 || res.status === 403 || res.status === 404;
      return { buffer: null, permanentFailure: permanent };
    }
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len > maxBytes) return { buffer: null, permanentFailure: true };
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > maxBytes) return { buffer: null, permanentFailure: true };
    return { buffer, permanentFailure: false };
  } finally {
    // A timeout/abort surfaces as a thrown fetch error → the job retries (transient).
    clearTimeout(timer);
  }
}

export async function processAttachmentJob(job: EmbedAttachmentJob): Promise<void> {
  const { message, attachment } = job;
  const msgHash = sha256(message.content);

  const { buffer, permanentFailure } = await download(attachment.url, config.ATTACHMENT_MAX_BYTES);

  if (!buffer) {
    if (permanentFailure) {
      // Record the attachment as skipped/failed but never crash the queue on it.
      const record: AttachmentRecord = {
        ...attachment,
        messageId: message.messageId,
        content: null,
        contentHash: null,
        extractStatus: ExtractStatus.Skipped,
      };
      await withTransaction(async (client) => {
        await upsertMessage(client, message, msgHash);
        await upsertAttachment(client, record);
      });
      logger.warn(
        { attachmentId: attachment.attachmentId },
        "attachment download failed (permanent)",
      );
      return;
    }
    throw new Error(`attachment download failed (retryable): ${attachment.attachmentId}`);
  }

  const isImage = isImageAttachment(attachment.contentType, attachment.filename);
  const { status, text } = isImage
    ? config.OCR_ENABLED
      ? await ocrExtract(buffer)
      : { status: ExtractStatus.Skipped, text: null }
    : await extract(buffer, attachment.contentType, attachment.filename);
  const contentHash = text ? sha256(text) : null;

  if (
    text &&
    contentHash &&
    (await alreadyEmbedded(SourceType.Attachment, attachment.attachmentId, contentHash))
  ) {
    return; // unchanged
  }

  const chunks = text ? chunkText(text).slice(0, config.MAX_CHUNKS_PER_JOB) : [];
  const embedded = await embedChunks(chunks);

  const record: AttachmentRecord = {
    ...attachment,
    messageId: message.messageId,
    content: text,
    contentHash,
    extractStatus: status,
  };

  await withTransaction(async (client) => {
    await upsertMessage(client, message, msgHash);
    await upsertAttachment(client, record);
    await replaceEmbeddings(
      client,
      SourceType.Attachment,
      attachment.attachmentId,
      message.messageId,
      embedded,
      config.EMBED_MODEL,
      config.EMBED_DIM,
      contentHash ?? "",
    );
  });
  logger.debug(
    { attachmentId: attachment.attachmentId, status, chunks: embedded.length },
    "processed attachment",
  );
}
