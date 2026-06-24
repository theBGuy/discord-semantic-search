import { logger } from "@app/shared";
import { type ChatInputCommandInteraction, type Client, MessageFlags } from "discord.js";
import { resolveAccess } from "../access";
import { apiSummarize } from "../api";
import { buildTextReply } from "../format";
import { resolveWindow } from "../window";

export async function handleSummarize(
  interaction: ChatInputCommandInteraction,
  client: Client,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const channelOpt = interaction.options.getChannel("channel");
  const { hours, label } = resolveWindow(interaction);
  const channelId = channelOpt?.id ?? interaction.channelId ?? undefined;

  const { guildIds, channelIds } = await resolveAccess(client, interaction, false);

  try {
    const { summary, messageCount } = await apiSummarize({
      channelId,
      hours,
      filters: { guildIds, channelIds },
    });
    const where = channelOpt?.name ? `#${channelOpt.name}` : "this channel";
    await interaction.editReply(
      buildTextReply(`🧵 Summary of ${where}`, summary, `${messageCount} messages · last ${label}`),
    );
  } catch (err) {
    logger.error({ err }, "/summarize failed");
    await interaction.editReply("Couldn't generate a summary right now. Please try again shortly.");
  }
}
