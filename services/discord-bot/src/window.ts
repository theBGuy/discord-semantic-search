import type { ChatInputCommandInteraction } from "discord.js";

const MAX_HOURS = 8760; // 1 year — matches the search-api schema cap

/** Resolve a lookback window from the `days` and `hours` options (which combine).
 * Defaults to 24h when neither is given; clamps to one year. Returns total hours
 * plus a human label like "7d", "3h", or "1d 2h". */
export function resolveWindow(interaction: ChatInputCommandInteraction): {
  hours: number;
  label: string;
} {
  const days = Math.max(0, interaction.options.getInteger("days") ?? 0);
  const hours = Math.max(0, interaction.options.getInteger("hours") ?? 0);

  let total = days * 24 + hours;
  if (total <= 0) return { hours: 24, label: "24h" };
  total = Math.min(total, MAX_HOURS);

  let label: string;
  if (days > 0 && hours > 0) label = `${days}d ${hours}h`;
  else if (days > 0) label = `${days}d`;
  else label = `${hours}h`;

  return { hours: total, label };
}
