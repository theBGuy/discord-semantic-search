import {
  getChatModel,
  getLocalChatModel,
  isCloudConfigured,
  listModels,
  logger,
  setChatModel,
  setLocalChatModel,
} from "@app/shared";
import {
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";

const codeList = (models: string[], sep: string, max: number) =>
  models
    .map((m) => `\`${m}\``)
    .join(sep)
    .slice(0, max) || "_(none listed)_";

// Short cache so autocomplete (fires per keystroke) doesn't hammer /api/tags or blow
// Discord's 3s deadline.
const modelCache = new Map<string, { models: string[]; expires: number }>();

async function cachedModels(endpoint: "cloud" | "local"): Promise<string[]> {
  const now = Date.now();
  const hit = modelCache.get(endpoint);
  if (hit && hit.expires > now) return hit.models;
  const models = await listModels(endpoint).catch(() => [] as string[]);
  modelCache.set(endpoint, { models, expires: now + 30_000 });
  return models;
}

export async function handleModelAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const typed = interaction.options.getFocused().toLowerCase();
  const scope = interaction.options.getString("scope") ?? "primary";
  const endpoint = scope === "local" ? "local" : isCloudConfigured() ? "cloud" : "local";
  const models = await cachedModels(endpoint);
  const choices = models
    .filter((m) => m.toLowerCase().includes(typed))
    .slice(0, 25)
    .map((m) => ({ name: m.slice(0, 100), value: m.slice(0, 100) }));
  await interaction.respond(choices).catch(() => {});
}

export async function handleModel(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const setName = interaction.options.getString("set");
  const scope = interaction.options.getString("scope") ?? "primary"; // "primary" | "local"
  const cloud = isCloudConfigured();

  try {
    if (setName) {
      // Validate against the endpoint the model will actually run on.
      const endpoint = scope === "local" ? "local" : cloud ? "cloud" : "local";
      const available = await listModels(endpoint).catch(() => [] as string[]);
      if (available.length > 0 && !available.includes(setName)) {
        await interaction.editReply(
          `Model \`${setName}\` isn't available on the ${endpoint} endpoint.\nAvailable: ${codeList(available, ", ", 1500)}`,
        );
        return;
      }
      if (scope === "local") await setLocalChatModel(setName);
      else await setChatModel(setName);
      const label = scope === "local" ? "Fallback (local)" : cloud ? "Primary (cloud)" : "Chat";
      await interaction.editReply(`✅ ${label} model set to \`${setName}\`.`);
      return;
    }

    const [primary, local] = await Promise.all([getChatModel(), getLocalChatModel()]);
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("🧠 Chat / reasoning model")
      .setDescription(
        cloud
          ? `Primary (cloud): \`${primary}\`\nFallback (local): \`${local}\``
          : `Model (local): \`${primary}\``,
      )
      .setFooter({ text: "Set with  /model set:<name> [scope:primary|fallback]" });

    if (cloud) {
      embed.addFields({
        name: "Cloud models",
        value: codeList(await listModels("cloud").catch(() => []), "\n", 1000),
      });
    }
    embed.addFields({
      name: "Local models",
      value: codeList(await listModels("local").catch(() => []), "\n", 1000),
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error({ err }, "/model failed");
    await interaction.editReply("Couldn't read or update the model right now.");
  }
}
