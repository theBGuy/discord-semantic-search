import { logger } from "./logger";

/** Install last-resort process handlers so a stray rejection or exception is logged
 * (with the service name) instead of silently taking the process down.
 *
 * - `unhandledRejection` is logged at error level; we do NOT exit (a single dropped
 *   promise shouldn't kill a long-running bot/worker).
 * - `uncaughtException` leaves the process in an undefined state, so we log fatally and
 *   exit non-zero for the supervisor (docker compose `restart`) to bring it back. */
export function installProcessGuards(service: string): void {
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason, service }, "unhandledRejection");
  });
  process.on("uncaughtException", (err) => {
    logger.fatal({ err, service }, "uncaughtException — exiting");
    process.exit(1);
  });
}
