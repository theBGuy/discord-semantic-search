import {
  ChannelType,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type GuildMember,
  PermissionsBitField,
} from "discord.js";

/** Channels/threads the member can View + Read Message History. Categories are
 * excluded (members don't read messages in them); threads are included when cached,
 * and the search layer additionally lets thread messages inherit parent access. */
function readableChannelIds(guild: Guild, member: GuildMember): string[] {
  const ids: string[] = [];
  for (const ch of guild.channels.cache.values()) {
    if (!ch || ch.type === ChannelType.GuildCategory) continue;
    const perms = ch.permissionsFor(member);
    if (
      perms?.has([
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.ReadMessageHistory,
      ])
    ) {
      ids.push(ch.id);
    }
  }
  return ids;
}

/**
 * Resolve which guilds + channels the invoking user is allowed to see, for use as
 * search filters. The returned `channelIds` is always defined (possibly empty) so
 * results are NEVER broader than the user's own channel access.
 */
export async function resolveAccess(
  client: Client,
  interaction: ChatInputCommandInteraction,
  allServers: boolean,
): Promise<{ guildIds: string[]; channelIds: string[] }> {
  const userId = interaction.user.id;

  if (!allServers) {
    const guild = interaction.guild;
    if (!guild) return { guildIds: [], channelIds: [] };
    await guild.channels.fetch().catch(() => null);
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return { guildIds: [guild.id], channelIds: [] };
    return { guildIds: [guild.id], channelIds: readableChannelIds(guild, member) };
  }

  // All servers: union of readable channels across every guild the user belongs to.
  const guildIds: string[] = [];
  const channelIds: string[] = [];
  for (const guild of client.guilds.cache.values()) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) continue;
    await guild.channels.fetch().catch(() => null);
    guildIds.push(guild.id);
    channelIds.push(...readableChannelIds(guild, member));
  }
  return { guildIds, channelIds };
}
