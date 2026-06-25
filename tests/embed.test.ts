import type { Message } from "discord.js";
import { describe, expect, it } from "vitest";
import { embedText } from "../services/discord-bot/src/convert";

/** Minimal stub: embedText only reads msg.embeds. */
function msg(embeds: unknown[]): Message {
  return { embeds } as unknown as Message;
}

describe("embedText", () => {
  it("returns an empty string when there are no embeds", () => {
    expect(embedText(msg([]))).toBe("");
  });

  it("flattens author, title, description, fields, and footer (GitHub webhook shape)", () => {
    const out = embedText(
      msg([
        {
          author: { name: "octocat/repo" },
          title: "[repo:feature-x] 1 new commit",
          description: "abc123 add feature-x",
          fields: [{ name: "Branch", value: "feature-x" }],
          footer: { text: "GitHub" },
        },
      ]),
    );
    expect(out).toContain("octocat/repo");
    expect(out).toContain("[repo:feature-x] 1 new commit");
    expect(out).toContain("add feature-x");
    expect(out).toContain("Branch: feature-x");
    expect(out).toContain("GitHub");
  });

  it("skips missing parts and concatenates multiple embeds", () => {
    const out = embedText(
      msg([
        { title: "A", fields: [] },
        { description: "B", fields: [] },
      ]),
    );
    expect(out).toBe("A\nB");
  });
});
