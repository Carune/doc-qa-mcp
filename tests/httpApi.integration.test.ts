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
        ENABLE_PGVECTOR: "false",
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
