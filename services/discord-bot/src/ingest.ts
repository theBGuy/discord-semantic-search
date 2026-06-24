import { config, enqueueAttachment, enqueueMessage, PRIORITY_LIVE, sha256 } from "@app/shared";
import type { Message } from "discord.js";
import { attachmentInputs, toMessageInput } from "./convert";

/** Build jobs for a single message (+ its extractable attachments) and enqueue them. */
export async function ingestMessage(msg: Message, priority = PRIORITY_LIVE): Promise<void> {
  if (!msg.inGuild()) return;
  if (config.SKIP_BOT_MESSAGES && (msg.author.bot || msg.webhookId !== null)) return;

  const input = toMessageInput(msg);
  await enqueueMessage(input, sha256(input.content), priority);
  for (const attachment of attachmentInputs(msg)) {
    await enqueueAttachment(input, attachment, priority);
  }
}
