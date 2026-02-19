import { SearchResult } from "../domain/types.js";

export function buildAnswerWithCitations(
  question: string,
  hits: SearchResult[],
): { answer: string; citations: Citation[] } {
  if (hits.length === 0) {
    return {
      answer:
        "질문과 관련된 문서를 찾지 못했습니다. 다른 키워드로 질문하거나 문서를 먼저 인덱싱해 주세요.",
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

  const answerLines: string[] = [
    `질문: ${question}`,
    "문서 근거 기반 요약:",
  ];

  for (let i = 0; i < Math.min(hits.length, 3); i += 1) {
    const hit = hits[i];
    answerLines.push(
      `${i + 1}. ${summarizeChunk(hit.chunk.text)} (출처: ${hit.source.path}#${hit.chunk.index})`,
    );
  }

  return {
    answer: answerLines.join("\n"),
    citations,
  };
}

interface Citation {
  source: string;
  chunk_id: string;
  chunk_index: number;
  score: number;
  snippet: string;
}

function summarizeChunk(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= 160) {
    return normalized;
  }
  return `${normalized.slice(0, 157)}...`;
}
