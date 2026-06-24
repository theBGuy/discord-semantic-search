import { describe, expect, it } from "vitest";
import { citedIndices, citedOnly, normalizeCitations } from "../services/discord-bot/src/format";

const cite = (index: number) => ({
  index,
  channelName: `c${index}`,
  authorName: `a${index}`,
  timestamp: "2026-01-01T00:00:00.000Z",
  url: `https://discord.com/channels/1/2/${index}`,
  preview: `preview ${index}`,
});

describe("normalizeCitations", () => {
  it("rewrites fullwidth citation brackets to ASCII", () => {
    expect(normalizeCitations("see 【3】 and 【1, 2】")).toBe("see [3] and [1, 2]");
  });

  it("leaves ASCII citations untouched", () => {
    expect(normalizeCitations("see [3] and [1, 2]")).toBe("see [3] and [1, 2]");
  });

  it("does not rewrite non-numeric fullwidth brackets", () => {
    expect(normalizeCitations("【note】")).toBe("【note】");
  });
});

describe("citedIndices", () => {
  it("collects ASCII and grouped citations", () => {
    expect([...citedIndices("foo [1] bar [2, 3]")].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("collects fullwidth citations", () => {
    expect([...citedIndices("foo 【4】")]).toEqual([4]);
  });

  it("ignores zero and bare (unbracketed) numbers", () => {
    expect(citedIndices("plain 5 text [0]").size).toBe(0);
  });
});

describe("citedOnly", () => {
  it("keeps only the sources the answer actually cites", () => {
    const res = citedOnly("answer using [2]", [cite(1), cite(2), cite(3)]);
    expect(res.map((c) => c.index)).toEqual([2]);
  });

  it("falls back to the top 5 when nothing is cited", () => {
    const all = [cite(1), cite(2), cite(3), cite(4), cite(5), cite(6)];
    const res = citedOnly("no citations here", all);
    expect(res.map((c) => c.index)).toEqual([1, 2, 3, 4, 5]);
  });
});
