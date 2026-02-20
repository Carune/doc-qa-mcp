import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { normalizeText } from "../../utils/text.js";

const execFileAsync = promisify(execFile);
const dynamicImport = new Function(
  "modulePath",
  "return import(modulePath)",
) as (modulePath: string) => Promise<unknown>;
const SUPPORTED_EXTENSIONS = new Set([".md", ".txt", ".pdf"]);

interface PdfParseResult {
  text?: string;
}

type LegacyPdfParseFn = (dataBuffer: Buffer) => Promise<PdfParseResult>;
type PdfParseV2Ctor = new (input: { data: Buffer }) => {
  getText: () => Promise<PdfParseResult>;
  destroy?: () => Promise<void> | void;
};

export function isSupportedDocumentExtension(filePath: string): boolean {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function getSupportedDocumentExtensions(): string[] {
  return [...SUPPORTED_EXTENSIONS];
}

export async function loadDocumentText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".md" || ext === ".txt") {
    const content = await fs.readFile(filePath, "utf-8");
    return normalizeText(content);
  }

  if (ext === ".pdf") {
    return loadPdfText(filePath);
  }

  throw new Error(
    `Unsupported extension: ${ext}. Allowed: ${getSupportedDocumentExtensions().join(", ")}`,
  );
}

export async function loadDocumentTextFromBuffer(
  sourceName: string,
  data: Buffer,
): Promise<string> {
  const ext = path.extname(sourceName).toLowerCase();

  if (ext === ".md" || ext === ".txt") {
    return normalizeText(data.toString("utf-8"));
  }

  if (ext === ".pdf") {
    return loadPdfTextFromBuffer(data);
  }

  throw new Error(
    `Unsupported extension: ${ext}. Allowed: ${getSupportedDocumentExtensions().join(", ")}`,
  );
}

async function loadPdfText(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return loadPdfTextFromBuffer(buffer, filePath);
}

async function loadPdfTextFromBuffer(
  buffer: Buffer,
  filePathForFallback?: string,
): Promise<string> {
  const viaPdfParse = await tryParsePdfWithLibrary(buffer);
  if (viaPdfParse) {
    return viaPdfParse;
  }

  if (filePathForFallback) {
    const viaPdftotext = await tryParsePdfWithPdftotext(filePathForFallback);
    if (viaPdftotext) {
      return viaPdftotext;
    }
  }

  throw new Error(
    "PDF parsing is unavailable. Install `pdf-parse` (`npm install pdf-parse`).",
  );
}

async function tryParsePdfWithLibrary(buffer: Buffer): Promise<string | null> {
  try {
    const mod = await dynamicImport("pdf-parse");
    const legacy = resolveLegacyPdfParse(mod);
    if (legacy) {
      const parsed = await legacy(buffer);
      const text = normalizeText(parsed.text ?? "");
      return text || null;
    }

    const ctor = resolvePdfParseV2Ctor(mod);
    if (!ctor) {
      return null;
    }

    const parser = new ctor({ data: buffer });
    try {
      const parsed = await parser.getText();
      const text = normalizeText(parsed.text ?? "");
      return text || null;
    } finally {
      if (typeof parser.destroy === "function") {
        await parser.destroy();
      }
    }
  } catch {
    return null;
  }
}

async function tryParsePdfWithPdftotext(filePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("pdftotext", ["-layout", filePath, "-"]);
    const text = normalizeText(stdout);
    return text || null;
  } catch {
    return null;
  }
}

function resolveLegacyPdfParse(mod: unknown): LegacyPdfParseFn | null {
  if (typeof mod === "function") {
    return mod as LegacyPdfParseFn;
  }

  if (!mod || typeof mod !== "object") {
    return null;
  }

  const candidate = (mod as { default?: unknown }).default;
  if (typeof candidate === "function") {
    return candidate as LegacyPdfParseFn;
  }

  return null;
}

function resolvePdfParseV2Ctor(mod: unknown): PdfParseV2Ctor | null {
  if (!mod || typeof mod !== "object") {
    return null;
  }

  const named = (mod as { PDFParse?: unknown }).PDFParse;
  if (typeof named === "function") {
    return named as PdfParseV2Ctor;
  }

  return null;
}
