import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BASE_URL = "http://127.0.0.1:3177";
let serverProcess: ChildProcessWithoutNullStreams | null = null;

describe("HTTP API integration", () => {
  beforeAll(async () => {
    serverProcess = spawn("node", ["--loader", "ts-node/esm", "src/server.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MCP_TRANSPORT: "http",
        MCP_HOST: "127.0.0.1",
        MCP_PORT: "3177",
        PERSIST_INMEMORY_INDEX: "false",
        ENABLE_PGVECTOR: "false",
        EMBEDDING_PROVIDER: "none",
        ANSWER_MODE: "client_llm",
        OPENAI_API_KEY: "",
      },
      stdio: "pipe",
    });

    await waitForHealthy();
  }, 30_000);

  afterAll(async () => {
    if (!serverProcess) {
      return;
    }

    serverProcess.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

  it("indexes and answers via REST endpoints", async () => {
    const indexResponse = await fetch(`${BASE_URL}/api/index`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paths: ["docs/sample-api.md", "docs/sample-oncall.md"],
      }),
    });
    expect(indexResponse.ok).toBe(true);
    const indexData = (await indexResponse.json()) as {
      indexed_count: number;
      failed: Array<{ path: string; reason: string }>;
    };
    expect(indexData.indexed_count).toBe(2);
    expect(indexData.failed).toHaveLength(0);

    const askResponse = await fetch(`${BASE_URL}/api/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: "What should we check first during an incident?",
      }),
    });
    expect(askResponse.ok).toBe(true);
    const askData = (await askResponse.json()) as {
      citations: unknown[];
      retrieval_mode: string;
      answer_generation_mode: string;
    };
    expect(askData.citations.length).toBeGreaterThan(0);
    expect(askData.retrieval_mode).toBe("lexical");
    expect(askData.answer_generation_mode).toBe("client_llm");
  });

  it("indexes raw uploaded text via /api/index-text", async () => {
    const response = await fetch(`${BASE_URL}/api/index-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documents: [
          {
            source: "manual-es.txt",
            content:
              "Cuando ocurre un incidente, primero identifique el alcance del impacto.",
          },
        ],
      }),
    });

    expect(response.ok).toBe(true);
    const data = (await response.json()) as { indexed_count: number; failed: unknown[] };
    expect(data.indexed_count).toBe(1);
    expect(data.failed).toHaveLength(0);
  });

  it("indexes uploaded files via /api/index-upload", async () => {
    const contentBase64 = Buffer.from(
      "Incident runbook: first confirm blast radius and current error rate.",
      "utf-8",
    ).toString("base64");

    const response = await fetch(`${BASE_URL}/api/index-upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [
          {
            source: "runbook-upload.txt",
            content_base64: contentBase64,
          },
        ],
      }),
    });

    expect(response.ok).toBe(true);
    const data = (await response.json()) as { indexed_count: number; failed: unknown[] };
    expect(data.indexed_count).toBe(1);
    expect(data.failed).toHaveLength(0);
  });

  it("supports reset and storage inspection endpoints", async () => {
    const storageResponse = await fetch(`${BASE_URL}/api/index/storage`);
    expect(storageResponse.ok).toBe(true);
    const storageData = (await storageResponse.json()) as {
      persisted: boolean;
      storage: unknown;
    };
    expect(storageData.persisted).toBe(false);
    expect(storageData.storage).toBeNull();

    const resetResponse = await fetch(`${BASE_URL}/api/index/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(resetResponse.ok).toBe(true);
    const resetData = (await resetResponse.json()) as {
      cleared_sources: number;
      cleared_chunks: number;
    };
    expect(resetData.cleared_sources).toBeGreaterThanOrEqual(0);
    expect(resetData.cleared_chunks).toBeGreaterThanOrEqual(0);
  });

  it("summarizes indexed documents via /api/summarize", async () => {
    const indexResponse = await fetch(`${BASE_URL}/api/index`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paths: ["docs/sample-api.md", "docs/sample-oncall.md"],
      }),
    });
    expect(indexResponse.ok).toBe(true);

    const response = await fetch(`${BASE_URL}/api/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instruction: "Summarize these documents in Korean.",
        max_chunks: 40,
      }),
    });

    expect(response.ok).toBe(true);
    const data = (await response.json()) as {
      summary: string;
      citations: unknown[];
      source_count: number;
      chunk_count_used: number;
    };

    expect(data.summary.length).toBeGreaterThan(0);
    expect(data.source_count).toBeGreaterThan(0);
    expect(data.chunk_count_used).toBeGreaterThan(0);
    expect(Array.isArray(data.citations)).toBe(true);
  });

  it("streams ask response via /api/ask-stream", async () => {
    const response = await fetch(`${BASE_URL}/api/ask-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: "What should we check first during an incident?",
        top_k: 3,
      }),
    });

    expect(response.ok).toBe(true);
    const text = await response.text();
    expect(text).toContain("event: meta");
    expect(text).toContain("event: done");
  });

  it("keeps structured extraction quality in /api/ask-stream for table list queries", async () => {
    const response = await fetch(`${BASE_URL}/api/index-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documents: [
          {
            source: "weekly-spec.txt",
            content: [
              "<테이블>",
              "*공통 - 입력자,입력일,수정자,수정일",
              "*사용자 (USER) - 아이디, 비밀번호, 이름, 부서, 직급",
              "*고객사 (CLIENT) - id, 이름, 설명, 휴일",
              "*프로젝트 (PROJECT) - id, 이름, 설명, 기간 s-e, 고객사ID",
              "*업무 (WORK) - id, 이름, 설명, 프로젝트ID",
              "*내용 (PROGRESS) - 진척도, 날짜, 완료일, 진행시간, 업무ID",
              "*주간업무보고서 (REPORT) - 날짜, 이슈사항, 향후 진행사항",
              "*주요사항 (KEYPOINT) - 종료일, 내용, 업무보고서ID, 고객사ID",
            ].join("\n"),
          },
        ],
      }),
    });
    expect(response.ok).toBe(true);

    const streamResponse = await fetch(`${BASE_URL}/api/ask-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: "테이블 목록 알려줘",
        top_k: 5,
      }),
    });
    expect(streamResponse.ok).toBe(true);
    const streamText = await streamResponse.text();

    expect(streamText).toContain("REPORT");
    expect(streamText).toContain("KEYPOINT");
    expect(streamText).toContain("공통");
  });
});

async function waitForHealthy() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Server did not become healthy in time.");
}
