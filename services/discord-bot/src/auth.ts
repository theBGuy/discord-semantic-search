import {
  getAccessMode,
  getRateLimitPerHour,
  hasGuildAdmin,
  isAdmin,
  isAllowed,
  isSuperAdmin,
} from "@app/shared";
import { type ChatInputCommandInteraction, PermissionFlagsBits } from "discord.js";
import { checkRate } from "./ratelimit";

// Operator-only (affects global state, e.g. the shared chat model).
const SUPER_ADMIN_COMMANDS = new Set(["model"]);
// Per-guild admin (scoped to the server where invoked).
const GUILD_ADMIN_COMMANDS = new Set(["index", "status", "admin"]);
const USER_COMMANDS = new Set(["search", "ask", "summarize", "digest", "kb"]);

export function memberRoleIds(interaction: ChatInputCommandInteraction): string[] {
  if (interaction.inCachedGuild()) return [...interaction.member.roles.cache.keys()];
  const raw = interaction.member;
  return raw && Array.isArray(raw.roles) ? raw.roles : [];
}

function hasManageGuild(interaction: ChatInputCommandInteraction): boolean {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

export interface AuthResult {
  allowed: boolean;
  reason?: string;
  /** When set on a denial, the gate records an audit entry with this as the detail.
   * Left undefined for operational noise (e.g. rate limiting) we don't want to log. */
  auditDetail?: string;
}

/** Authorize a slash command per per-guild governance. Env super-admins are admin in
 * every guild and the only ones allowed to run operator commands; guild admins manage
 * their own server; user commands obey that guild's access policy + rate limit. */
export async function authorize(interaction: ChatInputCommandInteraction): Promise<AuthResult> {
  const userId = interaction.user.id;
  const guildId = interaction.guildId;
  const cmd = interaction.commandName;

  if (!guildId) return { allowed: false, reason: "Please use this in a server." };

  if (SUPER_ADMIN_COMMANDS.has(cmd)) {
    if (isSuperAdmin(userId)) return { allowed: true };
    return {
      allowed: false,
      reason: "🔒 This command is restricted to the bot operator.",
      auditDetail: `operator-only · /${cmd}`,
    };
  }

  if (GUILD_ADMIN_COMMANDS.has(cmd)) {
    if (await isAdmin(guildId, userId)) return { allowed: true };
    // Bootstrap: before this server has its own admin, Manage-Server users qualify.
    if (!(await hasGuildAdmin(guildId)) && hasManageGuild(interaction)) return { allowed: true };
    return {
      allowed: false,
      reason: "🔒 This command is admin-only in this server.",
      auditDetail: `admin-only · /${cmd}`,
    };
  }

  if (USER_COMMANDS.has(cmd)) {
    if (await isAdmin(guildId, userId)) return { allowed: true };
    if ((await getAccessMode(guildId)) === "allowlist") {
      if (!(await isAllowed(guildId, userId, memberRoleIds(interaction)))) {
        return {
          allowed: false,
          reason:
            "🔒 You don't have access to this bot here. Ask a server admin to grant you access.",
          auditDetail: `no access · /${cmd}`,
        };
      }
    }
    const limit = await getRateLimitPerHour(guildId);
    if (!checkRate(`${guildId}:${userId}`, limit)) {
      return { allowed: false, reason: `⏳ Rate limit reached (${limit}/hour). Try again later.` };
    }
    return { allowed: true };
  }

  return { allowed: true };
}
