import { normalizeText } from "../utils/text.js";

const DEFAULT_MAX_CHARS = 650;
const DEFAULT_OVERLAP = 120;

interface SectionBlock {
  title: string | null;
  body: string;
}

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

  const sections = splitIntoSections(normalized);
  const chunks: string[] = [];

  for (const section of sections) {
    const prefix = section.title ? `[section] ${section.title}\n` : "";
    const maxBodyChars = Math.max(180, maxChars - prefix.length);
    const bodyParts = splitTextByNaturalBoundary(section.body, maxBodyChars, safeOverlap);

    for (const body of bodyParts) {
      const chunk = normalizeText(`${prefix}${body}`);
      if (chunk) {
        chunks.push(chunk);
      }
    }
  }

  return dedupeChunks(chunks);
}

function splitIntoSections(text: string): SectionBlock[] {
  const lines = text
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .map((line) => line.trim());

  const sections: SectionBlock[] = [];
  let currentTitle: string | null = null;
  let currentBodyLines: string[] = [];

  const flushCurrent = () => {
    const body = normalizeText(currentBodyLines.join("\n"));
    if (!body && !currentTitle) {
      currentBodyLines = [];
      return;
    }
    sections.push({ title: currentTitle, body });
    currentTitle = null;
    currentBodyLines = [];
  };

  for (const line of lines) {
    if (!line) {
      if (currentBodyLines.length > 0) {
        currentBodyLines.push("");
      }
      continue;
    }

    if (isSectionHeader(line)) {
      if (currentBodyLines.length > 0 || currentTitle) {
        flushCurrent();
      }
      currentTitle = cleanSectionTitle(line);
      continue;
    }

    currentBodyLines.push(line);
  }

  if (currentBodyLines.length > 0 || currentTitle) {
    flushCurrent();
  }

  return sections.length > 0 ? sections : [{ title: null, body: text }];
}

function isSectionHeader(line: string): boolean {
  if (/^#{1,6}\s+/.test(line)) {
    return true;
  }
  if (/^<[^>\n]{2,80}>$/.test(line)) {
    return true;
  }
  if (/^\[[^\]\n]{2,80}\]$/.test(line)) {
    return true;
  }
  if (/^[A-Za-z0-9 _-]{2,80}:$/.test(line)) {
    return true;
  }
  if (/^[\uAC00-\uD7A3A-Za-z0-9 _-]{2,40}\s*(구성도|테이블|액션|기타)$/.test(line)) {
    return true;
  }
  return false;
}

function cleanSectionTitle(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^</, "")
    .replace(/>$/, "")
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/:$/, "")
    .trim();
}

function splitTextByNaturalBoundary(
  text: string,
  maxChars: number,
  overlap: number,
): string[] {
  const normalized = normalizeText(text);
  if (!normalized) {
    return [];
  }
  if (normalized.length <= maxChars) {
    return [normalized];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    const hardEnd = Math.min(start + maxChars, normalized.length);
    let end = hardEnd;

    if (hardEnd < normalized.length) {
      const window = normalized.slice(start, hardEnd);
      const boundary = findLastBoundary(window);
      if (boundary >= Math.floor(maxChars * 0.55)) {
        end = start + boundary;
      }
    }

    const piece = normalized.slice(start, end).trim();
    if (piece) {
      chunks.push(piece);
    }

    if (end >= normalized.length) {
      break;
    }

    const nextStart = Math.max(0, end - overlap);
    start = nextStart > start ? nextStart : end;
  }

  return chunks;
}

function findLastBoundary(text: string): number {
  const candidates = [
    text.lastIndexOf("\n\n"),
    text.lastIndexOf("\n- "),
    text.lastIndexOf("\n* "),
    text.lastIndexOf("\n"),
    text.lastIndexOf(". "),
    text.lastIndexOf("! "),
    text.lastIndexOf("? "),
    text.lastIndexOf("; "),
    text.lastIndexOf(", "),
  ];

  let max = -1;
  for (const idx of candidates) {
    if (idx > max) {
      max = idx;
    }
  }
  return max < 0 ? text.length : max;
}

function dedupeChunks(chunks: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const chunk of chunks) {
    if (seen.has(chunk)) {
      continue;
    }
    seen.add(chunk);
    deduped.push(chunk);
  }

  return deduped;
}
