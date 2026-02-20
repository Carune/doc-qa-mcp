import { SearchResult } from "../domain/types.js";
import { isBroadQueryIntent } from "../utils/text.js";

export interface Citation {
  source: string;
  chunk_id: string;
  chunk_index: number;
  score: number;
  snippet: string;
}

export function buildAnswerWithCitations(
  question: string,
  hits: SearchResult[],
): { answer: string; citations: Citation[] } {
  if (hits.length === 0) {
    return {
      answer:
        "No relevant context was found in indexed documents. Try a more specific question.",
      citations: [],
    };
  }

  const citations: Citation[] = hits.map((hit) => ({
    source: hit.source.path,
    chunk_id: hit.chunk.id,
    chunk_index: hit.chunk.index,
    score: Number(hit.score.toFixed(4)),
    snippet: hit.chunk.text.slice(0, 280),
  }));

  const broadIntent = isBroadQueryIntent(question);
  const lines = [`Question: ${question}`, "Context-grounded summary:"];
  const lineLimit = broadIntent ? Math.min(hits.length, 6) : Math.min(hits.length, 3);
  for (let i = 0; i < lineLimit; i += 1) {
    const hit = hits[i];
    lines.push(
      `${i + 1}. ${summarizeChunk(hit.chunk.text)} (source: ${hit.source.path}#${hit.chunk.index})`,
    );
  }

  if (broadIntent) {
    const structured = extractStructuredItems(hits, 8);
    if (structured.length > 0) {
      lines.push("Key structured items:");
      for (const item of structured) {
        lines.push(`- ${item}`);
      }
    }
  }

  return {
    answer: lines.join("\n"),
    citations,
  };
}

function summarizeChunk(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= 180) {
    return normalized;
  }
  return `${normalized.slice(0, 177)}...`;
}

function extractStructuredItems(hits: SearchResult[], limit: number): string[] {
  const lines: string[] = [];

  for (const hit of hits) {
    const rawLines = hit.chunk.text.split("\n");
    for (const rawLine of rawLines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      if (line.length < 3) {
        continue;
      }
      if (
        /^[-*]\s+/.test(line) ||
        /^\d+\.\s+/.test(line) ||
        /^<[^>]{2,80}>$/.test(line) ||
        /\([A-Z_]+\)/.test(line)
      ) {
        lines.push(line);
      }
      if (lines.length >= limit) {
        return dedupe(lines).slice(0, limit);
      }
    }
  }

  return dedupe(lines).slice(0, limit);
}

function dedupe(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}
