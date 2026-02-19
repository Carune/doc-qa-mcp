import { SearchResult } from "../domain/types.js";

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

  const lines = [`Question: ${question}`, "Context-grounded summary:"];
  for (let i = 0; i < Math.min(hits.length, 3); i += 1) {
    const hit = hits[i];
    lines.push(
      `${i + 1}. ${summarizeChunk(hit.chunk.text)} (source: ${hit.source.path}#${hit.chunk.index})`,
    );
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
