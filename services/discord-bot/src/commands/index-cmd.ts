import { logger } from "@app/shared";
import { type ChatInputCommandInteraction, type Client, MessageFlags } from "discord.js";
import { runBackfill } from "../backfill";

const CHANNEL_OPTIONS = ["channel", "channel_2", "channel_3", "channel_4", "channel_5"];

export async function handleIndex(
  interaction: ChatInputCommandInteraction,
  client: Client,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const seen = new Set<string>();
  const channels = CHANNEL_OPTIONS.map((name) => interaction.options.getChannel(name))
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  const targetChannelIds = channels.map((c) => c.id);
  const reindex = interaction.options.getBoolean("reindex") ?? false;

  // Fire-and-forget: backfill can run long; it self-guards against concurrent runs
  // and is resumable, so we don't await it here. Scoped to the invoking server.
  void runBackfill(client, {
    guildId: interaction.guildId ?? undefined,
    targetChannelIds: targetChannelIds.length > 0 ? targetChannelIds : undefined,
    reset: reindex,
  }).catch((err) => logger.error({ err }, "backfill error"));

  const scope =
    channels.length === 0
      ? "all reachable channels"
      : channels.map((c) => `**${c.name ?? c.id}**`).join(", ");
  const how = reindex
    ? "Re-indexing from scratch (re-crawling already-indexed history)"
    : "Backfill started";
  await interaction.editReply(
    `${how} for ${scope}. It runs in the background — messages become searchable as they're indexed. Run again anytime to resume; use /status to watch progress.`,
  );
}
