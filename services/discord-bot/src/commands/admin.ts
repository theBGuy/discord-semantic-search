import {
  type AccessMode,
  addAdmin,
  allowRole,
  allowUser,
  disallowRole,
  disallowUser,
  getAccessMode,
  getRateLimitPerHour,
  isSuperAdmin,
  listAdmins,
  listAllowedRoles,
  listAllowedUsers,
  logger,
  removeAdmin,
  setAccessMode,
  setRateLimitPerHour,
} from "@app/shared";
import { type ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from "discord.js";

const fmt = (ids: string[], wrap: (id: string) => string) =>
  (ids.length ? ids.map(wrap).join(", ") : "_none_").slice(0, 1024);
const users = (ids: string[]) => fmt(ids, (i) => `<@${i}>`);
const roles = (ids: string[]) => fmt(ids, (i) => `<@&${i}>`);

export async function handleAdmin(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.editReply("Use this in a server.");
    return;
  }
  const sub = interaction.options.getSubcommand();
  const by = interaction.user.id;

  try {
    switch (sub) {
      case "show": {
        const [admins, mode, allowRoles, allowUsers, rate] = await Promise.all([
          listAdmins(guildId),
          getAccessMode(guildId),
          listAllowedRoles(guildId),
          listAllowedUsers(guildId),
          getRateLimitPerHour(guildId),
        ]);
        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("🛡️ Governance — this server")
          .addFields(
            { name: "Operator (env, all servers)", value: users(admins.superIds), inline: true },
            { name: "Server admins", value: users(admins.guildIds), inline: true },
            { name: "Access mode", value: `\`${mode}\``, inline: true },
            { name: "Allowed roles", value: roles(allowRoles) },
            { name: "Allowed users", value: users(allowUsers) },
            {
              name: "Rate limit",
              value: rate > 0 ? `${rate} commands / user / hour` : "disabled",
            },
          );
        await interaction.editReply({ embeds: [embed] });
        break;
      }

      case "add": {
        const u = interaction.options.getUser("user", true);
        await addAdmin(guildId, u.id, by);
        await interaction.editReply(`✅ <@${u.id}> is now an admin in this server.`);
        break;
      }

      case "remove": {
        const u = interaction.options.getUser("user", true);
        if (isSuperAdmin(u.id)) {
          await interaction.editReply(
            `<@${u.id}> is a global operator (BOOTSTRAP_ADMIN_IDS) and can't be removed here.`,
          );
          break;
        }
        await removeAdmin(guildId, u.id);
        await interaction.editReply(`✅ Removed <@${u.id}> from this server's admins.`);
        break;
      }

      case "access": {
        const mode = interaction.options.getString("mode", true) as AccessMode;
        await setAccessMode(guildId, mode);
        await interaction.editReply(
          mode === "open"
            ? "✅ Access set to **open** — anyone in this server can use the bot."
            : "✅ Access set to **allowlist** — only admins + allowed roles/users.",
        );
        break;
      }

      case "allow":
      case "disallow": {
        const role = interaction.options.getRole("role");
        const user = interaction.options.getUser("user");
        if (!role && !user) {
          await interaction.editReply("Provide a role and/or a user.");
          break;
        }
        const granting = sub === "allow";
        const parts: string[] = [];
        if (role) {
          await (granting ? allowRole(guildId, role.id, by) : disallowRole(guildId, role.id));
          parts.push(`<@&${role.id}>`);
        }
        if (user) {
          await (granting ? allowUser(guildId, user.id, by) : disallowUser(guildId, user.id));
          parts.push(`<@${user.id}>`);
        }
        await interaction.editReply(
          `✅ ${granting ? "Granted access to" : "Revoked access from"} ${parts.join(" and ")}.`,
        );
        break;
      }

      case "ratelimit": {
        const n = interaction.options.getInteger("per_hour", true);
        await setRateLimitPerHour(guildId, n);
        await interaction.editReply(
          n > 0 ? `✅ Rate limit set to ${n} commands / user / hour.` : "✅ Rate limit disabled.",
        );
        break;
      }
    }
  } catch (err) {
    logger.error({ err, sub }, "/admin failed");
    await interaction.editReply("Something went wrong updating governance.");
  }
}
