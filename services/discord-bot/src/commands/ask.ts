import { logger, type SearchFilters } from "@app/shared";
import { type ChatInputCommandInteraction, type Client, MessageFlags } from "discord.js";
import { resolveAccess } from "../access";
import { apiAsk } from "../api";
import { buildAskReply } from "../format";

export async function handleAsk(
  interaction: ChatInputCommandInteraction,
  client: Client,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const question = interaction.options.getString("question", true);
  const allServers = interaction.options.getBoolean("all_servers") ?? false;

  // Restrict retrieval to channels the invoking user can actually read.
  const { guildIds, channelIds } = await resolveAccess(client, interaction, allServers);
  const filters: SearchFilters = { guildIds, channelIds };

  try {
    const { answer, citations } = await apiAsk({ question, filters });
    await interaction.editReply(buildAskReply(question, answer, citations));
  } catch (err) {
    logger.error({ err }, "/ask failed");
    await interaction.editReply(
      "The assistant is unavailable right now. Please try again shortly.",
    );
  }
}
