import path from "node:path";
import { describe, expect, it } from "vitest";
import { DefaultAiClient } from "../src/infra/ai/defaultAiClient.js";
import { InMemoryKnowledgeBase } from "../src/infra/store/inMemoryKnowledgeBase.js";
import { DocumentQaService } from "../src/services/documentQaService.js";

describe("DocumentQaService", () => {
  it("indexes documents and returns grounded citations", async () => {
    const service = new DocumentQaService(
      new InMemoryKnowledgeBase(),
      createTestAiClient(),
    );

    const docs = [
      path.resolve("docs/sample-api.md"),
      path.resolve("docs/sample-oncall.md"),
    ];

    const indexResult = await service.indexDocuments(docs);
    expect(indexResult.indexed_count).toBe(2);
    expect(indexResult.failed).toHaveLength(0);

    const askResult = await service.askWithCitations({
      question: "What should we check first during an incident?",
    });

    expect(askResult.citations.length).toBeGreaterThan(0);
    expect(askResult.answer.toLowerCase()).toContain("incident");
    expect(askResult.retrieval_mode).toBe("lexical");
  });

  it("returns language guidance when lexical query language mismatches", async () => {
    const service = new DocumentQaService(
      new InMemoryKnowledgeBase(),
      createTestAiClient(),
    );

    await service.indexDocuments([path.resolve("docs/sample-api.md")]);
    const result = await service.askWithCitations({
      question: "장애 대응 첫 단계가 뭐야?",
    });

    expect(result.citations).toHaveLength(0);
    expect(result.guidance?.toLowerCase()).toContain("lexical mode");
  });
});

function createTestAiClient(): DefaultAiClient {
  return new DefaultAiClient({
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
    port: 3177,
    vectorDimension: 1536,
  });
}
