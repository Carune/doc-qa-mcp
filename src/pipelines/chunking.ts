import { normalizeText } from "../utils/text.js";

const DEFAULT_MAX_CHARS = 700;
const DEFAULT_OVERLAP = 120;

export function splitIntoChunks(
  text: string,
  maxChars: number = DEFAULT_MAX_CHARS,
  overlap: number = DEFAULT_OVERLAP,
): string[] {
  const safeOverlap = Math.min(Math.max(overlap, 0), maxChars - 1);
  const normalized = normalizeText(text);
  if (!normalized) {
    return [];
  }

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const chunks: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxChars) {
      chunks.push(paragraph);
      continue;
    }

    let start = 0;
    while (start < paragraph.length) {
      const end = Math.min(start + maxChars, paragraph.length);
      chunks.push(paragraph.slice(start, end).trim());

      if (end >= paragraph.length) {
        break;
      }
      start = end - safeOverlap;
    }
  }

  return chunks;
}
