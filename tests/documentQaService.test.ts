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
      question: "장애 대응 첫 단계 뭐야",
    });

    expect(result.citations).toHaveLength(0);
    expect(result.guidance?.toLowerCase()).toContain("lexical mode");
  });

  it("returns fallback chunks for broad summary intent in lexical mode", async () => {
    const service = new DocumentQaService(
      new InMemoryKnowledgeBase(),
      createTestAiClient(),
    );

    await service.indexRawDocuments([
      {
        source: "weekly-report.txt",
        content:
          "주간업무보고서 설계 문서입니다.\n\n<테이블>\n사용자, 고객사, 프로젝트, 업무, 내용 테이블이 포함됩니다.",
      },
    ]);

    const result = await service.askWithCitations({
      question: "문서 요약해줘",
      topK: 2,
    });

    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.answer.toLowerCase()).not.toContain("no relevant context");
  });

  it("expands adjacent chunks to preserve local context around top hits", async () => {
    const kb = new InMemoryKnowledgeBase();
    await kb.upsertSource({
      path: "upload://manual.txt",
      chunks: [
        {
          index: 0,
          text: "[section] 메뉴 구성도\n로그인 화면과 기본 설정",
          embedding: null,
        },
        {
          index: 1,
          text: "사이드 메뉴에는 일정 관리, 주간 보고서, 고객사 관리가 있다.",
          embedding: null,
        },
        {
          index: 2,
          text: "고객사 관리에서는 프로젝트별 캘린더와 프로젝트별 일정 조회를 지원한다.",
          embedding: null,
        },
        {
          index: 3,
          text: "프로젝트별 현황판에서 진척도 요약을 확인할 수 있다.",
          embedding: null,
        },
      ],
    });

    const service = new DocumentQaService(kb, createTestAiClient());
    const result = await service.askWithCitations({
      question: "프로젝트별 캘린더는 어디에서 보지?",
      topK: 2,
    });

    const citationIndexes = result.citations.map((item) => item.chunk_index);
    expect(citationIndexes).toContain(2);
    expect(citationIndexes).toContain(1);
  });

  it("extracts menu list and table-like entities for list/type queries", async () => {
    const service = new DocumentQaService(
      new InMemoryKnowledgeBase(),
      createTestAiClient(),
    );

    await service.indexRawDocuments([
      {
        source: "weekly-spec.txt",
        content: [
          "<테이블>",
          "*사용자 (USER) - 아이디, 비밀번호, 이름",
          "*주간업무보고서 (REPORT) - 날짜, 이슈사항",
          "*주요사항 (KEYPOINT) - 종료일, 내용",
          "",
          "<메뉴 구성도>",
          "사이드 메뉴",
          "-일정 관리",
          "-주간 보고서",
          "-고객사 관리",
        ].join("\n"),
      },
    ]);

    const menuResult = await service.askWithCitations({
      question: "사이드메뉴 종류 알려줘",
      topK: 3,
    });
    expect(menuResult.answer).toContain("일정 관리");
    expect(menuResult.answer).toContain("주간 보고서");
    expect(menuResult.answer).toContain("고객사 관리");

    const tableResult = await service.askWithCitations({
      question: "테이블 목록 알려줘",
      topK: 3,
    });
    expect(tableResult.answer).toContain("주간업무보고서 (REPORT)");
    expect(tableResult.answer).toContain("주요사항 (KEYPOINT)");
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
    persistInMemoryIndex: false,
    inMemoryIndexPath: ".data/inmemory-index.json",
    maxInMemoryIndexBytes: 20 * 1024 * 1024,
    vectorDimension: 1536,
  });
}
