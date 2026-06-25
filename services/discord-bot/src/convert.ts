import { type AttachmentInput, type MessageInput, supportedAttachment } from "@app/shared";
import type { Message } from "discord.js";

export function authorName(msg: Message): string {
  return msg.author.globalName ?? msg.author.username;
}

/** Flatten a message's embeds (author / title / description / fields / footer) into
 * searchable text. Integrations like GitHub, RSS, and status webhooks carry all of their
 * information in embeds with an empty message body, so without this their updates index
 * as blank. Also captures auto-generated link previews on human messages (extra context).
 * (Embeds, like content, are only populated when the Message Content intent is enabled.) */
export function embedText(msg: Message): string {
  const parts: string[] = [];
  for (const e of msg.embeds) {
    if (e.author?.name) parts.push(e.author.name);
    if (e.title) parts.push(e.title);
    if (e.description) parts.push(e.description);
    for (const f of e.fields) parts.push(`${f.name}: ${f.value}`);
    if (e.footer?.text) parts.push(e.footer.text);
  }
  return parts.join("\n");
}

/** Convert a discord.js message into our persistable shape. For messages inside a
 * thread, channelId is the thread id (which is also what the deep-link uses). The
 * indexed content is the message body plus any embed text. */
export function toMessageInput(msg: Message): MessageInput {
  const inThread = msg.channel.isThread();
  const content = [msg.content ?? "", embedText(msg)]
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n\n");
  return {
    messageId: msg.id,
    guildId: msg.guildId ?? "",
    channelId: msg.channelId,
    threadId: inThread ? msg.channelId : null,
    authorId: msg.author.id,
    authorName: authorName(msg),
    ts: msg.createdAt.toISOString(),
    content,
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
