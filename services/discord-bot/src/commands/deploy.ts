/** Standalone slash-command registration script (`pnpm deploy-commands`).
 * Registers globally, or to DISCORD_DEV_GUILD_ID for instant updates in dev. */
import { config, logger } from "@app/shared";
import { REST, Routes } from "discord.js";
import { commands } from "./definitions";

const token = config.DISCORD_TOKEN;
const clientId = config.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  logger.fatal("DISCORD_TOKEN and DISCORD_CLIENT_ID are required to register commands");
  process.exit(1);
}

const rest = new REST().setToken(token);

try {
  if (config.DISCORD_DEV_GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(clientId, config.DISCORD_DEV_GUILD_ID), {
      body: commands,
    });
    logger.info({ guild: config.DISCORD_DEV_GUILD_ID }, "registered guild commands (dev)");
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    logger.info("registered global commands (may take up to ~1h to propagate)");
  }
  process.exit(0);
} catch (err) {
  logger.fatal({ err }, "command registration failed");
  process.exit(1);
}
