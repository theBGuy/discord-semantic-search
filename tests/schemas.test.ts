import { describe, expect, it } from "vitest";
import { accessFiltersSchema, fullFiltersSchema } from "../services/search-api/src/schemas";

describe("accessFiltersSchema (fail-closed)", () => {
  it("rejects a request that omits the channelIds allow-list", () => {
    expect(accessFiltersSchema.safeParse({}).success).toBe(false);
    expect(accessFiltersSchema.safeParse({ guildIds: ["1"] }).success).toBe(false);
  });

  it("accepts an explicit empty allow-list (nothing visible to the caller)", () => {
    expect(accessFiltersSchema.safeParse({ channelIds: [] }).success).toBe(true);
  });

  it("accepts a populated allow-list", () => {
    expect(accessFiltersSchema.safeParse({ guildIds: ["1"], channelIds: ["2", "3"] }).success).toBe(
      true,
    );
  });
});

describe("fullFiltersSchema (fail-closed + optional narrowing)", () => {
  it("still requires channelIds", () => {
    expect(fullFiltersSchema.safeParse({ channelId: "5" }).success).toBe(false);
  });

  it("accepts optional narrowing fields alongside the allow-list", () => {
    const r = fullFiltersSchema.safeParse({
      channelIds: ["1"],
      channelId: "5",
      authorId: "9",
      after: "2026-01-01T00:00:00.000Z",
    });
    expect(r.success).toBe(true);
  });
});
