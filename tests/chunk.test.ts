import { describe, expect, it } from "vitest";
import { chunkText } from "../packages/shared/src/chunk";

describe("chunkText", () => {
  it("returns [] for empty or whitespace-only text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n  ")).toEqual([]);
  });

  it("returns one trimmed chunk when under the limit", () => {
    expect(chunkText("  hello world  ", 100, 20)).toEqual(["hello world"]);
  });

  it("splits long text into multiple chunks, each within maxChars", () => {
    const text = "a ".repeat(200).trim(); // ~399 chars
    const chunks = chunkText(text, 100, 20);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100);
  });

  it("emits no empty chunks", () => {
    const chunks = chunkText("word ".repeat(80).trim(), 60, 10);
    for (const c of chunks) expect(c.length).toBeGreaterThan(0);
  });

  it("terminates on a single long unbroken token (no infinite loop)", () => {
    const chunks = chunkText("x".repeat(500), 100, 20);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.length > 0)).toBe(true);
  });

  it("clamps overlap to at most half of maxChars", () => {
    // overlapChars far larger than maxChars must not cause start to go backwards.
    const chunks = chunkText("abcd ".repeat(60).trim(), 50, 1000);
    expect(chunks.length).toBeGreaterThan(1);
  });
});
