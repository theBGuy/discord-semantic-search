import { z } from "zod";

/**
 * `channelIds` is the per-user access allow-list and is REQUIRED on every route that
 * serves indexed content, so a request can never fall through to an unscoped (all
 * guilds/channels) query. An empty array means "nothing is visible to this caller" —
 * the query returns no rows. This makes search-api fail *closed*: a caller that forgets
 * to pass the access list gets a 400, not everyone's data.
 *
 * (Authorization is still computed in the bot via `resolveAccess`; this is
 * defense-in-depth at the trust boundary.)
 */
export const accessFiltersSchema = z.object({
  guildIds: z.array(z.string()).optional(),
  channelIds: z.array(z.string()),
});

/** Full search filters: the access allow-list plus optional narrowing. */
export const fullFiltersSchema = accessFiltersSchema.extend({
  channelId: z.string().optional(),
  authorId: z.string().optional(),
  after: z.string().optional(),
  before: z.string().optional(),
});
