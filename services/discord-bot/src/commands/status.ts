import { config, getBackfillStats, getIndexStats, getQueueStats, logger } from "@app/shared";
import { type ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from "discord.js";
import { getIndexerState } from "../backfill";
import { BRAND } from "../format";

const n = (x: number) => x.toLocaleString("en-US");

export async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildIds = interaction.guildId ? [interaction.guildId] : undefined;

  try {
    const [index, backfill, queue] = await Promise.all([
      getIndexStats(guildIds),
      getBackfillStats(guildIds),
      getQueueStats(), // queue is system-wide, not per-guild
    ]);

    const embed = new EmbedBuilder()
      .setColor(BRAND)
      .setTitle("📊 Index status")
      .addFields(
        {
          name: "Indexed (this server)",
          value: `Messages: **${n(index.messages)}**\nEmbeddings: **${n(index.embeddings)}**\nAttachments: **${n(index.attachments)}**\nChannels: **${n(index.channels)}**`,
          inline: true,
        },
        {
          name: "Backfill",
          value: `Scopes: **${backfill.scopes}**\nComplete: **${backfill.done}**\nIn progress: **${backfill.inProgress}**\nErrored: **${backfill.errored}**`,
          inline: true,
        },
        {
          name: "Queue (all servers)",
          value: queue.available
            ? `Pending: **${n(queue.pending)}**\nActive: **${queue.active}**\nDead-letter: **${queue.deadLetter}**`
            : "_starting up_",
          inline: true,
        },
        {
          name: "Indexer (this bot)",
          value: (() => {
            const idx = getIndexerState();
            return `Backfill: **${idx.running ? "running" : "idle"}**\nChannels in flight: **${idx.activeScopes}** / ${idx.concurrency}`;
          })(),
          inline: true,
        },
        {
          name: "Models",
          value: `Embed: \`${config.EMBED_MODEL}\` (${config.EMBED_DIM}d)\nChat: \`${config.CHAT_MODEL}\``,
        },
      );

    if (backfill.newestTs) {
      const unix = Math.floor(new Date(backfill.newestTs).getTime() / 1000);
      embed.addFields({ name: "Newest indexed message", value: `<t:${unix}:R>` });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error({ err }, "/status failed");
    await interaction.editReply("Couldn't fetch status right now.");
  }
}
