import { type Citation, messageUrl, type SearchHit } from "@app/shared";
import { EmbedBuilder } from "discord.js";

/** Mimir brand accent (gold) — the embed sidebar color across all of the bot's replies. */
export const BRAND = 0xfbbf24;
const COLOR = BRAND;
const MAX_FIELDS = 10; // embeds allow 25; keep replies scannable

function unixSeconds(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function oneLine(s: string, n = 160): string {
  return truncate(s.replace(/\s+/g, " ").trim(), n);
}

/** Build the /search reply: query in the title, one field per hit with a preview. */
export function buildSearchReply(query: string, hits: SearchHit[]): { embeds: EmbedBuilder[] } {
  const embed = new EmbedBuilder().setColor(COLOR).setTitle(`🔎 ${truncate(query, 250)}`);

  if (hits.length === 0) {
    embed.setDescription("No results found.");
    return { embeds: [embed] };
  }

  embed.setDescription(`${hits.length} result${hits.length === 1 ? "" : "s"}:`);
  for (const [i, h] of hits.slice(0, MAX_FIELDS).entries()) {
    const channel = h.channelName ? `#${h.channelName}` : "channel";
    const url = messageUrl(h.guildId, h.channelId, h.messageId);
    embed.addFields({
      name: truncate(`${i + 1}. ${channel} · ${h.authorName}`, 250),
      value: truncate(
        `<t:${unixSeconds(h.ts)}:R> · [jump](${url})\n> ${oneLine(h.chunkText || h.content)}`,
        1000,
      ),
    });
  }
  return { embeds: [embed] };
}

/** A plain titled-text embed (summaries, digests). */
export function buildTextReply(
  title: string,
  body: string,
  footer?: string,
): { embeds: EmbedBuilder[] } {
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(truncate(title, 250))
    .setDescription(truncate(body.trim() || "_Nothing to show._", 4000));
  if (footer) embed.setFooter({ text: truncate(footer, 2000) });
  return { embeds: [embed] };
}

/** A knowledge-base embed: generated body + the source messages it drew from. */
export function buildKbReply(
  title: string,
  body: string,
  citations: Citation[],
): { embeds: EmbedBuilder[] } {
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(truncate(title, 250))
    .setDescription(truncate(body.trim() || "_Nothing to show._", 4000));
  for (const c of citations.slice(0, MAX_FIELDS)) {
    const channel = c.channelName ? `#${c.channelName}` : "channel";
    embed.addFields({
      name: truncate(`[${c.index}] ${channel} · ${c.authorName}`, 250),
      value: truncate(
        `<t:${unixSeconds(c.timestamp)}:f> · [jump](${c.url})\n> ${oneLine(c.preview)}`,
        1000,
      ),
    });
  }
  return { embeds: [embed] };
}

// Citation markers the model may emit around a number: ASCII [..] or fullwidth 【..】
// (【/】 — common with qwen/CJK-trained models), allowing grouped forms [1, 2].
const CITATION_RE = /[[【]\s*([\d,\s]+?)\s*[\]】]/g;

/** Rewrite fullwidth citation brackets to ASCII so the shown answer matches the
 * source labels (only touches 【…】 that wrap numbers). */
export function normalizeCitations(text: string): string {
  return text.replace(/【\s*([\d,\s]+?)\s*】/g, "[$1]");
}

/** All distinct source numbers the model cited. */
export function citedIndices(answer: string): Set<number> {
  const refs = new Set<number>();
  for (const m of answer.matchAll(CITATION_RE)) {
    for (const part of (m[1] ?? "").split(/[\s,]+/)) {
      const n = Number(part);
      if (Number.isInteger(n) && n > 0) refs.add(n);
    }
  }
  return refs;
}

/** Keep only the sources the model actually cited; fall back to the top few. */
export function citedOnly(answer: string, citations: Citation[]): Citation[] {
  const refs = citedIndices(answer);
  const cited = citations.filter((c) => refs.has(c.index));
  return cited.length > 0 ? cited : citations.slice(0, 5);
}

/** Build the /ask reply: question in the title, answer in the body, cited sources
 * as fields with previews + jump links. Embeds dodge the 2000-char content cap. */
export function buildAskReply(
  question: string,
  answer: string,
  citations: Citation[],
): { embeds: EmbedBuilder[] } {
  const normalized = normalizeCitations(answer);
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`❓ ${truncate(question, 250)}`)
    .setDescription(truncate(normalized.trim() || "_No answer returned._", 4000));

  for (const c of citedOnly(normalized, citations).slice(0, MAX_FIELDS)) {
    const channel = c.channelName ? `#${c.channelName}` : "channel";
    embed.addFields({
      name: truncate(`[${c.index}] ${channel} · ${c.authorName}`, 250),
      value: truncate(
        `<t:${unixSeconds(c.timestamp)}:f> · [jump](${c.url})\n> ${oneLine(c.preview)}`,
        1000,
      ),
    });
  }
  return { embeds: [embed] };
}
