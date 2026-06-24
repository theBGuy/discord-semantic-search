import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { config } from "./config";

/** Maps to attachments.extract_status: 1=ok, 2=skipped, 3=failed. */
export const ExtractStatus = { Ok: 1, Skipped: 2, Failed: 3 } as const;
export type ExtractStatusValue = (typeof ExtractStatus)[keyof typeof ExtractStatus];

export interface ExtractResult {
  status: ExtractStatusValue;
  text: string | null;
}

const TEXT_EXTENSIONS = new Set([
  "txt",
  "text",
  "md",
  "markdown",
  "rst",
  "log",
  "csv",
  "tsv",
  "json",
  "yaml",
  "yml",
  "toml",
  "ini",
  "env",
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "c",
  "h",
  "cpp",
  "hpp",
  "cc",
  "cs",
  "php",
  "swift",
  "sh",
  "bash",
  "zsh",
  "sql",
  "html",
  "css",
  "scss",
  "xml",
  "vue",
  "svelte",
]);

function extOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : "";
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff", "gif"]);

/** Is this attachment an image we'd run OCR on? */
export function isImageAttachment(contentType: string | null, filename: string): boolean {
  const ct = (contentType ?? "").toLowerCase();
  return ct.startsWith("image/") || IMAGE_EXTENSIONS.has(extOf(filename));
}

/** Cheap pre-filter so the bot only enqueues attachments we can extract text from
 * (avoids downloading media the worker would just skip). Images count only when OCR
 * is enabled. */
export function supportedAttachment(contentType: string | null, filename: string): boolean {
  const ext = extOf(filename);
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("application/pdf") || ext === "pdf") return true;
  if (ct.includes("officedocument.wordprocessingml.document") || ext === "docx") return true;
  if (ct.startsWith("text/") || ct.includes("json")) return true;
  if (TEXT_EXTENSIONS.has(ext)) return true;
  return config.OCR_ENABLED && isImageAttachment(contentType, filename);
}

/**
 * Extract plain text from a downloaded attachment. Supports PDF, DOCX, and a broad
 * set of text/code/markdown formats. Unsupported types are `Skipped`; parse errors
 * are `Failed` (never thrown — the caller records the status and moves on).
 */
export async function extract(
  buffer: Buffer,
  contentType: string | null,
  filename: string,
): Promise<ExtractResult> {
  const ext = extOf(filename);
  const ct = (contentType ?? "").toLowerCase();

  try {
    if (ct.includes("application/pdf") || ext === "pdf") {
      const parser = new PDFParse({ data: buffer });
      try {
        const { text } = await parser.getText();
        return { status: ExtractStatus.Ok, text: text?.trim() || null };
      } finally {
        await parser.destroy();
      }
    }

    const isDocx = ct.includes("officedocument.wordprocessingml.document") || ext === "docx";
    if (isDocx) {
      const { value } = await mammoth.extractRawText({ buffer });
      return { status: ExtractStatus.Ok, text: value?.trim() || null };
    }

    const isText = ct.startsWith("text/") || ct.includes("json") || TEXT_EXTENSIONS.has(ext);
    if (isText) {
      // A NUL byte means the payload is binary mislabelled as text — skip it.
      if (buffer.includes(0)) return { status: ExtractStatus.Skipped, text: null };
      const text = buffer.toString("utf8").trim();
      return { status: ExtractStatus.Ok, text: text || null };
    }

    return { status: ExtractStatus.Skipped, text: null };
  } catch {
    return { status: ExtractStatus.Failed, text: null };
  }
}
