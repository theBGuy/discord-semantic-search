import { logger } from "@app/shared";
import { type ChatInputCommandInteraction, type Client, MessageFlags } from "discord.js";
import { resolveAccess } from "../access";
import { apiDigest } from "../api";
import { buildTextReply } from "../format";
import { resolveWindow } from "../window";

export async function handleDigest(
  interaction: ChatInputCommandInteraction,
  client: Client,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { hours, label } = resolveWindow(interaction);
  const { guildIds, channelIds } = await resolveAccess(client, interaction, false);

  try {
    const { digest, messageCount } = await apiDigest({ hours, filters: { guildIds, channelIds } });
    await interaction.editReply(
      buildTextReply(`📰 Digest — last ${label}`, digest, `${messageCount} messages`),
    );
  } catch (err) {
    logger.error({ err }, "/digest failed");
    await interaction.editReply("Couldn't generate a digest right now. Please try again shortly.");
  }
}
