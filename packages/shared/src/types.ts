/** Embedding source discriminator (matches embeddings.source_type). */
export const SourceType = { Message: 0, Attachment: 1 } as const;
export type SourceTypeValue = (typeof SourceType)[keyof typeof SourceType];

/** Crawl-scope discriminator (matches indexing_state.scope_type). */
export const ScopeType = { Channel: 0, Thread: 1 } as const;
export type ScopeTypeValue = (typeof ScopeType)[keyof typeof ScopeType];

/** A message ready to be persisted. All snowflake IDs are strings. */
export interface MessageInput {
  messageId: string;
  guildId: string;
  channelId: string;
  threadId: string | null;
  authorId: string;
  authorName: string;
  ts: string; // ISO-8601
  content: string;
}

export interface ChannelInput {
  channelId: string;
  guildId: string;
  parentId: string | null;
  name: string | null;
  type: number | null;
}

export interface AttachmentInput {
  attachmentId: string;
  filename: string;
  contentType: string | null;
  size: number | null;
  url: string;
}

/** Job: embed a message's text content. */
export interface EmbedMessageJob {
  kind: "message";
  message: MessageInput;
}

/** Job: download an attachment, extract its text, and embed it. Carries the parent
 * message so the worker can UPSERT it first (FK safety) regardless of job order. */
export interface EmbedAttachmentJob {
  kind: "attachment";
  message: MessageInput;
  attachment: AttachmentInput;
}

export type Job = EmbedMessageJob | EmbedAttachmentJob;

export type SearchMode = "semantic" | "hybrid";

export interface SearchFilters {
  guildIds?: string[];
  channelId?: string;
  authorId?: string;
  /** ISO timestamps (inclusive lower / upper bounds). */
  after?: string;
  before?: string;
  /** Per-user access allow-list: a row is kept only if its channel_id is in this
   * list OR its parent channel is (so threads inherit parent access). `undefined`
   * means no restriction; an empty array means nothing is visible. */
  channelIds?: string[];
}

/** A single search result (best chunk per message). */
export interface SearchHit {
  messageId: string;
  guildId: string;
  channelId: string;
  channelName: string | null;
  threadId: string | null;
  authorId: string;
  authorName: string;
  ts: string;
  content: string;
  chunkText: string;
  score: number;
}

/** Persisted crawl checkpoint for one channel/thread. */
export interface ScopeState {
  scopeId: string;
  scopeType: ScopeTypeValue;
  guildId: string;
  parentId: string | null;
  oldestSeenId: string | null;
  newestSeenId: string | null;
  backfillDone: boolean;
  archivedDone: boolean;
  lastError: string | null;
}

/** A message row for chronological summary/digest building. */
export interface RecentMessage {
  messageId: string;
  channelId: string;
  channelName: string | null;
  authorName: string;
  ts: string;
  content: string;
}

export interface Citation {
  /** 1-based number matching the [n] reference the model uses in its answer. */
  index: number;
  channelName: string | null;
  authorName: string;
  timestamp: string;
  url: string;
  /** Short snippet of the source message, for display. */
  preview: string;
}

/** Build the canonical Discord deep-link for a message. */
export function messageUrl(guildId: string, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}
