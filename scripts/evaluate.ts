import { readFile } from "node:fs/promises";
import path from "node:path";
import { DefaultAiClient } from "../src/infra/ai/defaultAiClient.js";
import { InMemoryKnowledgeBase } from "../src/infra/store/inMemoryKnowledgeBase.js";
import { DocumentQaService } from "../src/services/documentQaService.js";

interface EvalQuestion {
  question: string;
  expected_source_contains: string;
  expected_keywords: string[];
}

async function main() {
  const service = new DocumentQaService(
    new InMemoryKnowledgeBase(),
    new DefaultAiClient({
      enablePgvector: false,
      databaseUrl: null,
      openaiApiKey: null,
      embeddingModel: "text-embedding-3-small",
      embeddingProvider: "none",
      answerMode: "client_llm",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaChatModel: "qwen2.5:7b-instruct",
      ollamaEmbeddingModel: "nomic-embed-text",
      transport: "http",
      host: "127.0.0.1",
      port: 3000,
      persistInMemoryIndex: false,
      inMemoryIndexPath: ".data/inmemory-index.json",
      maxInMemoryIndexBytes: 20 * 1024 * 1024,
      vectorDimension: 1536,
    }),
  );

  await service.indexDocuments([
    path.resolve("docs/sample-api.md"),
    path.resolve("docs/sample-oncall.md"),
  ]);

  const questions = await loadQuestions();
  const rows: Array<{
    question: string;
    top_citation_ok: boolean;
    top3_citation_ok: boolean;
    keyword_hit: boolean;
    latency_ms: number;
  }> = [];

  for (const item of questions) {
    const result = await service.askWithCitations({
      question: item.question,
      topK: 3,
    });

    const topCitation = result.citations[0]?.source ?? "";
    const topCitationOk = topCitation.includes(item.expected_source_contains);
    const top3CitationOk = result.citations
      .slice(0, 3)
      .some((citation) => citation.source.includes(item.expected_source_contains));
    const answerLower = result.answer.toLowerCase();
    const keywordHit = item.expected_keywords.some((keyword) =>
      answerLower.includes(keyword.toLowerCase()),
    );

    rows.push({
      question: item.question,
      top_citation_ok: topCitationOk,
      top3_citation_ok: top3CitationOk,
      keyword_hit: keywordHit,
      latency_ms: result.latency_ms,
    });
  }

  const citationHitRate = ratio(
    rows.filter((row) => row.top_citation_ok).length,
    rows.length,
  );
  const top3CitationHitRate = ratio(
    rows.filter((row) => row.top3_citation_ok).length,
    rows.length,
  );
  const keywordHitRate = ratio(
    rows.filter((row) => row.keyword_hit).length,
    rows.length,
  );
  const avgLatencyMs = Math.round(
    rows.reduce((sum, row) => sum + row.latency_ms, 0) / rows.length,
  );

  console.log("Evaluation Summary");
  console.log("==================");
  console.log(`questions: ${rows.length}`);
  console.log(`top_citation_hit_rate: ${citationHitRate}`);
  console.log(`top3_citation_hit_rate: ${top3CitationHitRate}`);
  console.log(`keyword_hit_rate: ${keywordHitRate}`);
  console.log(`avg_latency_ms: ${avgLatencyMs}`);
  console.log("");
  console.log("Per Question");
  console.log("------------");
  for (const row of rows) {
    console.log(
      `- ${row.question} | top1=${row.top_citation_ok} | top3=${row.top3_citation_ok} | keyword=${row.keyword_hit} | latency=${row.latency_ms}ms`,
    );
  }
}

async function loadQuestions(): Promise<EvalQuestion[]> {
  const raw = await readFile(path.resolve("eval/questions.json"), "utf-8");
  return JSON.parse(raw) as EvalQuestion[];
}

function ratio(hit: number, total: number): string {
  if (total === 0) {
    return "0.00";
  }
  return (hit / total).toFixed(2);
}

main().catch((error) => {
  console.error("Evaluation failed:", error);
  process.exit(1);
});
