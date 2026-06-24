import { type AttachmentInput, type MessageInput, supportedAttachment } from "@app/shared";
import type { Message } from "discord.js";

export function authorName(msg: Message): string {
  return msg.author.globalName ?? msg.author.username;
}

/** Convert a discord.js message into our persistable shape. For messages inside a
 * thread, channelId is the thread id (which is also what the deep-link uses). */
export function toMessageInput(msg: Message): MessageInput {
  const inThread = msg.channel.isThread();
  return {
    messageId: msg.id,
    guildId: msg.guildId ?? "",
    channelId: msg.channelId,
    threadId: inThread ? msg.channelId : null,
    authorId: msg.author.id,
    authorName: authorName(msg),
    ts: msg.createdAt.toISOString(),
    content: msg.content ?? "",
  };
}

/** Only attachments we can extract text from (pre-filter to avoid downloading media). */
export function attachmentInputs(msg: Message): AttachmentInput[] {
  const out: AttachmentInput[] = [];
  for (const a of msg.attachments.values()) {
    if (!supportedAttachment(a.contentType, a.name)) continue;
    out.push({
      attachmentId: a.id,
      filename: a.name,
      contentType: a.contentType,
      size: a.size,
      url: a.url,
    });
  }
  return out;
}
