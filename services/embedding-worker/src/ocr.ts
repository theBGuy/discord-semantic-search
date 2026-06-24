import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, type ExtractResult, ExtractStatus, logger } from "@app/shared";

/** Run the local Tesseract binary on an image file, returning recognized text.
 * Killed after OCR_TIMEOUT_MS so a pathological image can't hang the worker. */
function runTesseract(imagePath: string, lang: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // `--psm 3` = fully automatic page segmentation (a good default for screenshots).
    const proc = spawn("tesseract", [imagePath, "stdout", "-l", lang, "--psm", "3"]);
    let out = "";
    let err = "";
    const timer = setTimeout(() => proc.kill("SIGKILL"), config.OCR_TIMEOUT_MS);
    proc.stdout.on("data", (d) => {
      out += d.toString();
    });
    proc.stderr.on("data", (d) => {
      err += d.toString();
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`tesseract exited ${code}: ${err.slice(0, 200)}`));
    });
  });
}

/**
 * OCR an image buffer to text. Writes to a temp file (Tesseract detects the format
 * better from a file than from stdin), then cleans up. Never throws — returns a
 * status the caller records: Ok with text, Skipped (too little text), or Failed.
 */
export async function ocrExtract(
  buffer: Buffer,
  lang: string = config.OCR_LANG,
): Promise<ExtractResult> {
  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), "ocr-"));
    const file = join(dir, "image");
    await writeFile(file, buffer);
    const raw = await runTesseract(file, lang);
    const text = raw
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (text.length < config.OCR_MIN_CHARS) return { status: ExtractStatus.Skipped, text: null };
    return { status: ExtractStatus.Ok, text };
  } catch (err) {
    logger.debug({ err }, "ocr failed");
    return { status: ExtractStatus.Failed, text: null };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
