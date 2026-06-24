import { logger, type SearchFilters } from "@app/shared";
import { type ChatInputCommandInteraction, type Client, MessageFlags } from "discord.js";
import { resolveAccess } from "../access";
import { apiSearch } from "../api";
import { buildSearchReply } from "../format";

export async function handleSearch(
  interaction: ChatInputCommandInteraction,
  client: Client,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const query = interaction.options.getString("query", true);
  const mode = interaction.options.getString("mode") === "hybrid" ? "hybrid" : "semantic";
  const channel = interaction.options.getChannel("channel");
  const allServers = interaction.options.getBoolean("all_servers") ?? false;

  // Restrict results to channels the invoking user can actually read.
  const { guildIds, channelIds } = await resolveAccess(client, interaction, allServers);
  const filters: SearchFilters = { guildIds, channelIds };
  if (channel) filters.channelId = channel.id;

  try {
    const { hits } = await apiSearch({ query, mode, filters });
    await interaction.editReply(buildSearchReply(query, hits));
  } catch (err) {
    logger.error({ err }, "/search failed");
    await interaction.editReply("Search is unavailable right now. Please try again shortly.");
  }
}
