import { logger } from "@app/shared";
import { type ChatInputCommandInteraction, type Client, MessageFlags } from "discord.js";
import { resolveAccess } from "../access";
import { apiKb } from "../api";
import { buildKbReply } from "../format";

const KIND_LABEL: Record<string, string> = {
  faq: "FAQ",
  decisions: "Decision log",
  timeline: "Timeline",
};

export async function handleKb(
  interaction: ChatInputCommandInteraction,
  client: Client,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const topic = interaction.options.getString("topic", true);
  const kind = interaction.options.getString("kind") ?? "faq";
  const { guildIds, channelIds } = await resolveAccess(client, interaction, false);

  try {
    const { content, citations } = await apiKb({ topic, kind, filters: { guildIds, channelIds } });
    await interaction.editReply(
      buildKbReply(`📚 ${KIND_LABEL[kind] ?? "FAQ"}: ${topic}`, content, citations),
    );
  } catch (err) {
    logger.error({ err }, "/kb failed");
    await interaction.editReply("Couldn't generate that right now. Please try again shortly.");
  }
}
