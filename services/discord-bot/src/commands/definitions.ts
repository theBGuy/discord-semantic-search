import { SlashCommandBuilder } from "discord.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("search")
    .setDescription("Semantic search across indexed messages")
    .addStringOption((o) =>
      o.setName("query").setDescription("What to search for").setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("mode")
        .setDescription("semantic (default) or hybrid (adds keyword matching)")
        .addChoices({ name: "semantic", value: "semantic" }, { name: "hybrid", value: "hybrid" }),
    )
    .addChannelOption((o) => o.setName("channel").setDescription("Limit to a single channel"))
    .addBooleanOption((o) =>
      o.setName("all_servers").setDescription("Search every indexed server (default: this one)"),
    )
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask a question answered from indexed messages, with citations")
    .addStringOption((o) => o.setName("question").setDescription("Your question").setRequired(true))
    .addBooleanOption((o) =>
      o.setName("all_servers").setDescription("Use every indexed server (default: this one)"),
    )
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("index")
    .setDescription("Start or resume historical backfill")
    .addChannelOption((o) =>
      o
        .setName("channel")
        .setDescription("Limit to a channel or category (default: everything). Add up to 5."),
    )
    .addChannelOption((o) =>
      o.setName("channel_2").setDescription("Additional channel/category to index"),
    )
    .addChannelOption((o) =>
      o.setName("channel_3").setDescription("Additional channel/category to index"),
    )
    .addChannelOption((o) =>
      o.setName("channel_4").setDescription("Additional channel/category to index"),
    )
    .addChannelOption((o) =>
      o.setName("channel_5").setDescription("Additional channel/category to index"),
    )
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("model")
    .setDescription("View or set the chat/reasoning model")
    .addStringOption((o) =>
      o
        .setName("set")
        .setDescription("Model name to switch to (omit to view available)")
        .setAutocomplete(true),
    )
    .addStringOption((o) =>
      o
        .setName("scope")
        .setDescription("Which model to set (default: primary/cloud)")
        .addChoices(
          { name: "primary (cloud)", value: "primary" },
          { name: "fallback (local)", value: "local" },
        ),
    )
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show indexing status, queue depth, and backfill progress")
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Bot governance: admins, access, rate limit")
    .setDMPermission(false)
    .addSubcommand((s) => s.setName("show").setDescription("Show current governance settings"))
    .addSubcommand((s) =>
      s
        .setName("add")
        .setDescription("Add a bot admin")
        .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("remove")
        .setDescription("Remove a bot admin")
        .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("access")
        .setDescription("Set who can use the bot")
        .addStringOption((o) =>
          o
            .setName("mode")
            .setDescription("open = everyone; allowlist = admins + allowed roles/users")
            .setRequired(true)
            .addChoices({ name: "open", value: "open" }, { name: "allowlist", value: "allowlist" }),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName("allow")
        .setDescription("Grant access to a role and/or user")
        .addRoleOption((o) => o.setName("role").setDescription("Role to allow"))
        .addUserOption((o) => o.setName("user").setDescription("User to allow")),
    )
    .addSubcommand((s) =>
      s
        .setName("disallow")
        .setDescription("Revoke access from a role and/or user")
        .addRoleOption((o) => o.setName("role").setDescription("Role to revoke"))
        .addUserOption((o) => o.setName("user").setDescription("User to revoke")),
    )
    .addSubcommand((s) =>
      s
        .setName("ratelimit")
        .setDescription("Set per-user commands/hour (0 = off)")
        .addIntegerOption((o) =>
          o
            .setName("per_hour")
            .setDescription("Max commands per user per hour")
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(100000),
        ),
    ),

  new SlashCommandBuilder()
    .setName("summarize")
    .setDescription("Summarize a channel's recent conversation")
    .addChannelOption((o) =>
      o.setName("channel").setDescription("Channel/thread to summarize (default: here)"),
    )
    .addIntegerOption((o) =>
      o.setName("days").setDescription("Days back (e.g. 7)").setMinValue(1).setMaxValue(365),
    )
    .addIntegerOption((o) =>
      o
        .setName("hours")
        .setDescription("Hours back — adds to days (default 24h total)")
        .setMinValue(1)
        .setMaxValue(8760),
    )
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("digest")
    .setDescription("Topic digest of recent activity across channels you can see")
    .addIntegerOption((o) =>
      o.setName("days").setDescription("Days back (e.g. 7)").setMinValue(1).setMaxValue(365),
    )
    .addIntegerOption((o) =>
      o
        .setName("hours")
        .setDescription("Hours back — adds to days (default 24h total)")
        .setMinValue(1)
        .setMaxValue(8760),
    )
    .setDMPermission(false),

  new SlashCommandBuilder()
    .setName("kb")
    .setDescription("Generate a knowledge-base entry on a topic from history")
    .addStringOption((o) => o.setName("topic").setDescription("Topic").setRequired(true))
    .addStringOption((o) =>
      o
        .setName("kind")
        .setDescription("faq (default), decisions, or timeline")
        .addChoices(
          { name: "faq", value: "faq" },
          { name: "decisions", value: "decisions" },
          { name: "timeline", value: "timeline" },
        ),
    )
    .setDMPermission(false),
].map((c) => c.toJSON());
