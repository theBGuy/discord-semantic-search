import {
  config,
  getScope,
  logger,
  PRIORITY_BACKFILL,
  resetScope,
  ScopeType,
  type ScopeTypeValue,
  updateScope,
  upsertChannel,
  upsertScope,
} from "@app/shared";
import {
  ChannelType,
  type Client,
  type ForumChannel,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type MediaChannel,
  type NewsChannel,
  PermissionsBitField,
  type TextChannel,
} from "discord.js";
import { ingestMessage } from "./ingest";
import { sleep } from "./util";

const PAGE_DELAY_MS = 120;

interface ScopeDef {
  channel: GuildTextBasedChannel; // has .messages.fetch
  scopeType: ScopeTypeValue;
  parentId: string | null;
}

type ArchivableParent = TextChannel | NewsChannel | ForumChannel | MediaChannel;

let running = false;
let activeScopes = 0;

/** Live backfill state, surfaced by /status. */
export function getIndexerState(): { running: boolean; activeScopes: number; concurrency: number } {
  return { running, activeScopes, concurrency: config.BACKFILL_CONCURRENCY };
}

function canRead(
  channel: { permissionsFor(m: GuildMember): Readonly<PermissionsBitField> | null },
  me: GuildMember | null,
): boolean {
  if (!me) return false;
  const perms = channel.permissionsFor(me);
  return (
    perms?.has([
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.ReadMessageHistory,
    ]) ?? false
  );
}

async function collectArchived(
  parent: ArchivableParent,
  add: (channel: GuildTextBasedChannel, type: ScopeTypeValue, parentId: string | null) => void,
): Promise<void> {
  let before: number | undefined;
  for (let iter = 0; iter < 200; iter++) {
    const fetched = await parent.threads
      .fetchArchived({ type: "public", limit: 100, before })
      .catch((err) => {
        logger.warn({ err, parent: parent.id }, "fetchArchived failed");
        return null;
      });
    if (!fetched) break;
    for (const thread of fetched.threads.values()) add(thread, ScopeType.Thread, parent.id);
    const oldest = fetched.threads.last();
    if (!fetched.hasMore || !oldest?.archiveTimestamp) break;
    before = oldest.archiveTimestamp;
    await sleep(PAGE_DELAY_MS);
  }
}

/** Compute the set of root channel ids in scope for a targeted /index. Returns null
 * for "everything". Each category target expands to its child channels; a
 * channel/thread target is just itself (its threads are matched by parentId). */
function scopeRootIds(guild: Guild, targetChannelIds?: string[]): Set<string> | null {
  if (!targetChannelIds || targetChannelIds.length === 0) return null;
  const ids = new Set<string>();
  for (const targetId of targetChannelIds) {
    const target = guild.channels.cache.get(targetId);
    if (target?.type === ChannelType.GuildCategory) {
      for (const ch of guild.channels.cache.values()) {
        if (ch?.parentId === targetId) ids.add(ch.id);
      }
    } else {
      ids.add(targetId);
    }
  }
  return ids;
}

async function collectScopes(
  guild: Guild,
  me: GuildMember | null,
  targetChannelIds?: string[],
): Promise<{ scopes: ScopeDef[]; skipped: number }> {
  await guild.channels.fetch();
  const roots = scopeRootIds(guild, targetChannelIds);
  const inScope = (channelId: string, parentId: string | null) =>
    roots === null || roots.has(channelId) || (parentId !== null && roots.has(parentId));

  const scopes: ScopeDef[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  const add = (
    channel: GuildTextBasedChannel,
    scopeType: ScopeTypeValue,
    parentId: string | null,
  ) => {
    if (seen.has(channel.id)) return;
    if (!inScope(channel.id, parentId)) return;
    if (!canRead(channel, me)) {
      skipped++;
      logger.warn(
        { channel: channel.id, name: channel.name },
        "skipping scope — missing View Channel / Read Message History",
      );
      return;
    }
    seen.add(channel.id);
    scopes.push({ channel, scopeType, parentId });
  };

  // Top-level message channels.
  for (const ch of guild.channels.cache.values()) {
    if (ch && (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement)) {
      add(ch, ScopeType.Channel, ch.parentId);
    }
  }

  // Active threads (includes forum posts).
  const active = await guild.channels.fetchActiveThreads().catch((err) => {
    logger.warn({ err, guild: guild.id }, "fetchActiveThreads failed");
    return null;
  });
  if (active) {
    for (const thread of active.threads.values()) add(thread, ScopeType.Thread, thread.parentId);
  }

  // Archived public threads, per in-scope thread-bearing parent.
  for (const ch of guild.channels.cache.values()) {
    if (
      ch &&
      (ch.type === ChannelType.GuildText ||
        ch.type === ChannelType.GuildAnnouncement ||
        ch.type === ChannelType.GuildForum ||
        ch.type === ChannelType.GuildMedia) &&
      inScope(ch.id, ch.parentId) &&
      // Skip parents the bot can't read — avoids 403s that count against Discord's
      // invalid-request limit (the channel is already logged as skipped above).
      canRead(ch, me)
    ) {
      await collectArchived(ch, add);
    }
  }

  return { scopes, skipped };
}

/** Forward catch-up: enqueue messages newer than the stored high-watermark (covers
 * messages posted while the bot was offline). Seeds the watermark on first sight. */
async function catchUp(scope: ScopeDef, newestSeenId: string | null): Promise<number> {
  if (!newestSeenId) {
    const latest = await scope.channel.messages.fetch({ limit: 1, cache: false });
    const newest = latest.first();
    if (newest) await updateScope(scope.channel.id, { newestSeenId: newest.id });
    return 0;
  }

  let newest = newestSeenId;
  let cursor = newestSeenId;
  let total = 0;
  while (true) {
    const page = await scope.channel.messages.fetch({ limit: 100, after: cursor, cache: false });
    if (page.size === 0) break;
    let maxId = BigInt(newest);
    for (const msg of page.values()) {
      await ingestMessage(msg, PRIORITY_BACKFILL);
      const id = BigInt(msg.id);
      if (id > maxId) {
        maxId = id;
        newest = msg.id;
      }
    }
    total += page.size;
    cursor = newest;
    await updateScope(scope.channel.id, { newestSeenId: newest });
    if (page.size < 100) break;
    await sleep(PAGE_DELAY_MS);
  }
  return total;
}

/** Backward backfill: walk history from the resume cursor toward the oldest message. */
async function backfillBackward(scope: ScopeDef, oldestSeenId: string | null): Promise<number> {
  let cursor: string | undefined = oldestSeenId ?? undefined;
  let total = 0;
  let pages = 0;
  while (true) {
    const page = await scope.channel.messages.fetch({ limit: 100, before: cursor, cache: false });
    if (page.size === 0) {
      await updateScope(scope.channel.id, { backfillDone: true });
      break;
    }
    let oldest = cursor ? BigInt(cursor) : null;
    let oldestStr = cursor;
    for (const msg of page.values()) {
      await ingestMessage(msg, PRIORITY_BACKFILL);
      const id = BigInt(msg.id);
      if (oldest === null || id < oldest) {
        oldest = id;
        oldestStr = msg.id;
      }
    }
    // Persist the cursor only AFTER the page's jobs are durably enqueued.
    await updateScope(scope.channel.id, { oldestSeenId: oldestStr });
    cursor = oldestStr;
    total += page.size;
    pages++;
    if (pages % 10 === 0) {
      logger.info(
        { channel: scope.channel.id, name: scope.channel.name, seen: total },
        "backfill progress",
      );
    }
    if (page.size < 100) {
      await updateScope(scope.channel.id, { backfillDone: true });
      break;
    }
    await sleep(PAGE_DELAY_MS);
  }
  return total;
}

async function crawlScope(scope: ScopeDef, reset: boolean): Promise<number> {
  const ch = scope.channel;
  const isThread = scope.scopeType === ScopeType.Thread;
  await upsertChannel({
    channelId: ch.id,
    guildId: ch.guildId,
    parentId: scope.parentId,
    name: ch.name,
    type: ch.type,
  });
  await upsertScope(ch.id, scope.scopeType, ch.guildId, scope.parentId);
  // reindex: clear checkpoints so we re-walk the whole scope from scratch.
  if (reset) await resetScope(ch.id);
  const state = await getScope(ch.id);
  const alreadyDone = state?.backfillDone ?? false;
  logger.info({ channel: ch.id, name: ch.name, thread: isThread, alreadyDone }, "indexing scope");

  try {
    const forward = await catchUp(scope, state?.newestSeenId ?? null);
    const backward = alreadyDone ? 0 : await backfillBackward(scope, state?.oldestSeenId ?? null);
    await updateScope(ch.id, { lastError: null });
    const enqueued = forward + backward;
    logger.info({ channel: ch.id, name: ch.name, thread: isThread, enqueued }, "scope indexed");
    return enqueued;
  } catch (err) {
    // Skip this scope on permission/transient errors; keep going with the rest.
    logger.error({ err, scope: ch.id, name: ch.name }, "crawl scope failed");
    await updateScope(ch.id, { lastError: String(err) }).catch(() => {});
    return 0;
  }
}

/** Run `worker` over `items` with bounded concurrency, summing the results. */
async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<number>,
): Promise<number> {
  let next = 0;
  let total = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      if (item !== undefined) total += await worker(item);
    }
  });
  await Promise.all(runners);
  return total;
}

async function backfillGuild(
  guild: Guild,
  targetChannelIds?: string[],
  reset = false,
): Promise<void> {
  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  const { scopes, skipped } = await collectScopes(guild, me, targetChannelIds);
  logger.info(
    {
      guild: guild.id,
      name: guild.name,
      scopes: scopes.length,
      skipped,
      reset,
      concurrency: config.BACKFILL_CONCURRENCY,
    },
    "backfilling guild",
  );
  const messagesEnqueued = await runPool(scopes, config.BACKFILL_CONCURRENCY, async (scope) => {
    activeScopes++;
    try {
      return await crawlScope(scope, reset);
    } finally {
      activeScopes--;
    }
  });
  logger.info(
    { guild: guild.id, name: guild.name, scopes: scopes.length, skipped, messagesEnqueued },
    "guild backfill pass complete",
  );
}

/** Crawl accessible guilds (optionally just specific channels/categories). Guarded
 * against concurrent runs; scopes within a guild crawl with BACKFILL_CONCURRENCY. */
export async function runBackfill(
  client: Client,
  opts: { guildId?: string; targetChannelIds?: string[]; reset?: boolean } = {},
): Promise<void> {
  if (running) {
    logger.warn("backfill already running; ignoring trigger");
    return;
  }
  running = true;
  try {
    const guilds = opts.guildId
      ? [client.guilds.cache.get(opts.guildId)].filter((g): g is Guild => g != null)
      : [...client.guilds.cache.values()];
    for (const guild of guilds) {
      await backfillGuild(guild, opts.targetChannelIds, opts.reset);
    }
    logger.info("backfill complete");
  } finally {
    running = false;
    activeScopes = 0;
  }
}

/** Lightweight: refresh channel names/types for all visible channels (no message
 * crawl) so citations are named even before a full backfill runs. */
export async function syncChannels(client: Client): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.channels.fetch();
      for (const ch of guild.channels.cache.values()) {
        if (!ch) continue;
        await upsertChannel({
          channelId: ch.id,
          guildId: guild.id,
          parentId: ch.parentId ?? null,
          name: ch.name,
          type: ch.type,
        });
      }
    } catch (err) {
      logger.warn({ err, guild: guild.id }, "syncChannels failed");
    }
  }
}
