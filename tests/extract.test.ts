import { describe, expect, it } from "vitest";
import {
  ExtractStatus,
  extract,
  isImageAttachment,
  supportedAttachment,
} from "../packages/shared/src/extract";

describe("extract", () => {
  it("extracts UTF-8 text files", async () => {
    const r = await extract(Buffer.from("hello world", "utf8"), "text/plain", "a.txt");
    expect(r.status).toBe(ExtractStatus.Ok);
    expect(r.text).toBe("hello world");
  });

  it("skips a text payload containing a NUL byte (binary mislabeled as text)", async () => {
    const buf = Buffer.from([104, 105, 0, 104, 105]); // "hi" + NUL + "hi"
    const r = await extract(buf, "text/plain", "a.txt");
    expect(r.status).toBe(ExtractStatus.Skipped);
    expect(r.text).toBeNull();
  });

  it("treats code/markdown extensions as text", async () => {
    const r = await extract(Buffer.from("const x = 1;", "utf8"), null, "a.ts");
    expect(r.status).toBe(ExtractStatus.Ok);
    expect(r.text).toContain("const x");
  });

  it("skips unsupported binary types", async () => {
    const r = await extract(Buffer.from("xx"), "application/octet-stream", "a.bin");
    expect(r.status).toBe(ExtractStatus.Skipped);
  });
});

describe("isImageAttachment", () => {
  it("detects images by content type or extension", () => {
    expect(isImageAttachment("image/png", "x")).toBe(true);
    expect(isImageAttachment(null, "shot.PNG")).toBe(true);
    expect(isImageAttachment("text/plain", "a.txt")).toBe(false);
  });
});

describe("supportedAttachment", () => {
  it("accepts pdf, docx, text, and code", () => {
    expect(supportedAttachment("application/pdf", "a.pdf")).toBe(true);
    expect(supportedAttachment(null, "a.docx")).toBe(true);
    expect(supportedAttachment(null, "a.md")).toBe(true);
  });

  it("rejects unknown binary types", () => {
    expect(supportedAttachment("application/zip", "a.zip")).toBe(false);
  });
});
