import { PgBoss } from "pg-boss";
import { databaseUrl } from "./config";
import { logger } from "./logger";
import type { AttachmentInput, EmbedAttachmentJob, EmbedMessageJob, MessageInput } from "./types";

export const QUEUE_MESSAGE = "embed-message";
export const QUEUE_ATTACHMENT = "embed-attachment";
export const QUEUE_DLQ = "embed-dlq";

/** Priorities: real-time ingest preempts the (much larger) historical backfill. */
export const PRIORITY_LIVE = 100;
export const PRIORITY_BACKFILL = 0;

let instance: PgBoss | null = null;

/** Lazily start a shared pg-boss instance and ensure all queues exist. */
export async function getBoss(): Promise<PgBoss> {
  if (instance) return instance;
  const boss = new PgBoss({ connectionString: databaseUrl, schema: "pgboss" });
  boss.on("error", (err) => logger.error({ err }, "pg-boss error"));
  await boss.start();

  await boss.createQueue(QUEUE_DLQ);
  // `stately`: at most one job per singletonKey across created+active state, so a
  // duplicate enqueue (backfill re-fetch / restart) is suppressed while one is
  // pending — yet an edit (new content hash → new key) still enqueues. DB-side
  // ON CONFLICT remains the real idempotency guarantee regardless.
  const policy = {
    policy: "stately",
    deadLetter: QUEUE_DLQ,
    retryLimit: 5,
    retryBackoff: true,
  } as const;
  await boss.createQueue(QUEUE_MESSAGE, { ...policy, expireInSeconds: 300 });
  await boss.createQueue(QUEUE_ATTACHMENT, { ...policy, expireInSeconds: 600 });

  instance = boss;
  return boss;
}

export async function stopBoss(): Promise<void> {
  if (instance) {
    await instance.stop({ graceful: true });
    instance = null;
  }
}

/** Enqueue a message-embedding job. singletonKey includes the content hash so an
 * edit (new hash) is NOT deduplicated against a still-queued job for the same id. */
export async function enqueueMessage(
  message: MessageInput,
  contentHash: string,
  priority = PRIORITY_LIVE,
): Promise<string | null> {
  const boss = await getBoss();
  const job: EmbedMessageJob = { kind: "message", message };
  return boss.send(QUEUE_MESSAGE, job, {
    priority,
    singletonKey: `msg:${message.messageId}:${contentHash}`,
  });
}

/** Enqueue an attachment-embedding job. Attachments are immutable per message, so
 * the attachment id alone is a sufficient dedup key. */
export async function enqueueAttachment(
  message: MessageInput,
  attachment: AttachmentInput,
  priority = PRIORITY_LIVE,
): Promise<string | null> {
  const boss = await getBoss();
  const job: EmbedAttachmentJob = { kind: "attachment", message, attachment };
  return boss.send(QUEUE_ATTACHMENT, job, {
    priority,
    singletonKey: `att:${attachment.attachmentId}`,
  });
}

/** Register `concurrency` independent pollers (pg-boss uses SKIP LOCKED, so each
 * grabs a distinct job) — distinct jobs are embedded in parallel. */
export async function workMessages(
  handler: (job: EmbedMessageJob) => Promise<void>,
  concurrency = 1,
): Promise<void> {
  const boss = await getBoss();
  for (let i = 0; i < concurrency; i++) {
    await boss.work<EmbedMessageJob>(QUEUE_MESSAGE, { batchSize: 1 }, async (jobs) => {
      for (const job of jobs) await handler(job.data);
    });
  }
}

export async function workAttachments(
  handler: (job: EmbedAttachmentJob) => Promise<void>,
  concurrency = 1,
): Promise<void> {
  const boss = await getBoss();
  for (let i = 0; i < concurrency; i++) {
    await boss.work<EmbedAttachmentJob>(QUEUE_ATTACHMENT, { batchSize: 1 }, async (jobs) => {
      for (const job of jobs) await handler(job.data);
    });
  }
}
