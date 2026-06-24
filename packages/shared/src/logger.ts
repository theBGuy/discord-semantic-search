import { pino } from "pino";
import { config } from "./config";

/**
 * Structured logger. Stays local (logs may contain message content) — never ship
 * these logs off-host, and avoid logging full query/result bodies at info level.
 */
export const logger = pino({
  level: config.LOG_LEVEL,
  base: undefined,
});

export type Logger = typeof logger;
