import { describe, expect, it } from "vitest";
import { detectTemporal } from "../services/search-api/src/temporal";

describe("detectTemporal", () => {
  it("detects 'first' (origin) intent", () => {
    for (const q of [
      "when was the kolbot:restructure branch started?",
      "what was the first commit to the repo",
      "when did the project begin",
      "earliest mention of the crash",
      "when was this channel created",
    ]) {
      expect(detectTemporal(q)).toBe("first");
    }
  });

  it("detects 'last' (recency) intent", () => {
    for (const q of [
      "what's the latest on the migration",
      "the last time we discussed pricing",
      "most recent update to the docs",
      "newest release of kolbot",
    ]) {
      expect(detectTemporal(q)).toBe("last");
    }
  });

  it("returns null for non-temporal questions", () => {
    for (const q of [
      "how do I configure ollama",
      "what does the rate limiter do",
      "who wrote the chunker",
    ]) {
      expect(detectTemporal(q)).toBeNull();
    }
  });

  it("prefers 'first' when both cues appear", () => {
    expect(detectTemporal("when did the latest restructure first start")).toBe("first");
  });
});
