import {
  closePool,
  config,
  isSuperAdmin,
  logger,
  markChannelMessagesDeleted,
  markMessageDeleted,
  stopBoss,
  upsertChannel,
} from "@app/shared";
import {
  Client,
  Events,
  GatewayIntentBits,
  type Message,
  MessageFlags,
  Partials,
} from "discord.js";
import { authorize } from "./auth";
import { runBackfill, syncChannels } from "./backfill";
import { handleAdmin } from "./commands/admin";
import { handleAsk } from "./commands/ask";
import { handleDigest } from "./commands/digest";
import { handleIndex } from "./commands/index-cmd";
import { handleKb } from "./commands/kb";
import { handleModel, handleModelAutocomplete } from "./commands/model";
import { handleSearch } from "./commands/search";
import { handleStatus } from "./commands/status";
import { handleSummarize } from "./commands/summarize";
import { ingestMessage } from "./ingest";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  // Partials so edit/delete events fire for messages not in the cache (e.g. history).
  partials: [Partials.Message, Partials.Channel],
});

client.once(Events.ClientReady, (c) => {
  logger.info({ user: c.user.tag, guilds: c.guilds.cache.size }, "discord-bot ready");
  void syncChannels(c).catch((err) => logger.warn({ err }, "initial channel sync failed"));
  if (config.BACKFILL_ON_START) {
    void runBackfill(c).catch((err) => logger.error({ err }, "startup backfill failed"));
  }
});

client.on(Events.MessageCreate, (msg) => {
  void ingestMessage(msg).catch((err) => logger.error({ err }, "live ingest failed"));
});

client.on(Events.MessageUpdate, (_old, updated) => {
  void (async () => {
    try {
      const full = updated.partial ? await updated.fetch() : (updated as Message);
      await ingestMessage(full);
    } catch (err) {
      logger.error({ err }, "edit re-ingest failed");
    }
  })();
});

client.on(Events.MessageDelete, (msg) => {
  void markMessageDeleted(msg.id).catch((err) => logger.error({ err }, "delete tombstone failed"));
});

client.on(Events.MessageBulkDelete, (messages) => {
  for (const id of messages.keys()) {
    void markMessageDeleted(id).catch((err) =>
      logger.error({ err }, "bulk-delete tombstone failed"),
    );
  }
});

// A deleted channel/thread leaves its messages unreachable — tombstone them so they
// stop surfacing in search (and their now-dead jump links disappear).
const onContainerDelete = (channelId: string) => {
  void markChannelMessagesDeleted(channelId)
    .then((count) => {
      if (count > 0) logger.info({ channelId, count }, "tombstoned messages of deleted channel");
    })
    .catch((err) => logger.error({ err, channelId }, "channel-delete tombstone failed"));
};
client.on(Events.ChannelDelete, (channel) => onContainerDelete(channel.id));
client.on(Events.ThreadDelete, (thread) => onContainerDelete(thread.id));

client.on(Events.ThreadCreate, (thread) => {
  void upsertChannel({
    channelId: thread.id,
    guildId: thread.guildId,
    parentId: thread.parentId ?? null,
    name: thread.name,
    type: thread.type,
  }).catch(() => {});
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    // /model is operator-only — don't leak model lists to others.
    if (interaction.commandName === "model" && isSuperAdmin(interaction.user.id)) {
      await handleModelAutocomplete(interaction).catch((err) =>
        logger.error({ err }, "model autocomplete failed"),
      );
    } else {
      await interaction.respond([]).catch(() => {});
    }
    return;
  }
  if (!interaction.isChatInputCommand()) return;

  const auth = await authorize(interaction);
  if (!auth.allowed) {
    await interaction
      .reply({ content: auth.reason ?? "Not allowed.", flags: MessageFlags.Ephemeral })
      .catch(() => {});
    return;
  }

  try {
    switch (interaction.commandName) {
      case "search":
        await handleSearch(interaction, client);
        break;
      case "ask":
        await handleAsk(interaction, client);
        break;
      case "index":
        await handleIndex(interaction, client);
        break;
      case "model":
        await handleModel(interaction);
        break;
      case "status":
        await handleStatus(interaction);
        break;
      case "admin":
        await handleAdmin(interaction);
        break;
      case "summarize":
        await handleSummarize(interaction, client);
        break;
      case "digest":
        await handleDigest(interaction, client);
        break;
      case "kb":
        await handleKb(interaction, client);
        break;
    }
  } catch (err) {
    logger.error({ err, command: interaction.commandName }, "interaction handler failed");
  }
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "shutting down discord-bot");
  await client.destroy().catch(() => {});
  await stopBoss().catch(() => {});
  await closePool().catch(() => {});
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

if (!config.DISCORD_TOKEN) {
  logger.fatal("DISCORD_TOKEN is required");
  process.exit(1);
}

client.login(config.DISCORD_TOKEN);
