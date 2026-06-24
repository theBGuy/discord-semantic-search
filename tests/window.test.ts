import type { ChatInputCommandInteraction } from "discord.js";
import { describe, expect, it } from "vitest";
import { resolveWindow } from "../services/discord-bot/src/window";

/** Minimal stub: resolveWindow only reads interaction.options.getInteger. */
function fake(days: number | null, hours: number | null): ChatInputCommandInteraction {
  return {
    options: { getInteger: (name: string) => (name === "days" ? days : hours) },
  } as unknown as ChatInputCommandInteraction;
}

describe("resolveWindow", () => {
  it("defaults to 24h when neither days nor hours is given", () => {
    expect(resolveWindow(fake(null, null))).toEqual({ hours: 24, label: "24h" });
  });

  it("combines days and hours", () => {
    expect(resolveWindow(fake(1, 2))).toEqual({ hours: 26, label: "1d 2h" });
  });

  it("labels days-only and hours-only windows", () => {
    expect(resolveWindow(fake(7, null))).toEqual({ hours: 168, label: "7d" });
    expect(resolveWindow(fake(null, 3))).toEqual({ hours: 3, label: "3h" });
  });

  it("clamps to one year", () => {
    expect(resolveWindow(fake(400, null)).hours).toBe(8760);
  });

  it("treats negative inputs as zero", () => {
    expect(resolveWindow(fake(-5, -5))).toEqual({ hours: 24, label: "24h" });
  });
});
