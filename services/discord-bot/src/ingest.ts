import { config, enqueueAttachment, enqueueMessage, PRIORITY_LIVE, sha256 } from "@app/shared";
import type { Message } from "discord.js";
import { attachmentInputs, toMessageInput } from "./convert";

/** Build jobs for a single message (+ its extractable attachments) and enqueue them. */
export async function ingestMessage(msg: Message, priority = PRIORITY_LIVE): Promise<void> {
  if (!msg.inGuild()) return;

  const attachments = attachmentInputs(msg);
  // SKIP_BOT_MESSAGES drops chatty bot/webhook output — but keep messages that carry real
  // information in embeds or extractable attachments (e.g. GitHub / RSS / status webhooks,
  // whose content lives entirely in an embed). Set SKIP_BOT_MESSAGES=false to index all
  // bot text too.
  const fromBot = msg.author.bot || msg.webhookId !== null;
  const informative = msg.embeds.length > 0 || attachments.length > 0;
  if (config.SKIP_BOT_MESSAGES && fromBot && !informative) return;

  const input = toMessageInput(msg);
  await enqueueMessage(input, sha256(input.content), priority);
  for (const attachment of attachments) {
    await enqueueAttachment(input, attachment, priority);
  }
}
