import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import "dotenv/config";
import { z } from "zod";
import { loadConfig } from "./config/env.js";
import { DefaultAiClient } from "./infra/ai/defaultAiClient.js";
import { RetrievedContext } from "./infra/ai/types.js";
import { createKnowledgeBase } from "./infra/store/createKnowledgeBase.js";
import { DocumentQaService } from "./services/documentQaService.js";
import { registerIndexDocumentsTool } from "./tools/indexDocuments.js";
import { registerListSourcesTool } from "./tools/listSources.js";
import { registerSearchChunksTool } from "./tools/searchChunks.js";
import { registerAskWithCitationsTool } from "./tools/askWithCitations.js";

interface SessionEntry {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

type SessionMap = Record<string, SessionEntry>;

const MCP_PATH = "/mcp";
const API_PREFIX = "/api";
const UI_PATH = "/";
const indexApiSchema = z.object({
  paths: z.array(z.string()).min(1),
});
const indexTextApiSchema = z.object({
  documents: z
    .array(
      z.object({
        source: z.string().min(1),
        content: z.string().min(1),
      }),
    )
    .min(1),
});
const indexUploadApiSchema = z.object({
  files: z
    .array(
      z.object({
        source: z.string().min(1),
        content_base64: z.string().min(1),
      }),
    )
    .min(1),
});
const searchApiSchema = z.object({
  query: z.string().min(2),
  top_k: z.number().int().min(1).max(20).optional(),
  source_filter: z.array(z.string()).optional(),
});
const askApiSchema = z.object({
  question: z.string().min(2),
  top_k: z.number().int().min(1).max(10).optional(),
  source_filter: z.array(z.string()).optional(),
});
const summarizeApiSchema = z.object({
  instruction: z.string().min(2).optional(),
  source_filter: z.array(z.string()).optional(),
  max_chunks: z.number().int().min(10).max(300).optional(),
});

async function main() {
  const config = loadConfig();
  const aiClient = new DefaultAiClient(config);

  if (config.enablePgvector && !aiClient.isEmbeddingConfigured()) {
    throw new Error(
      "pgvector mode requires embeddings. Set EMBEDDING_PROVIDER=openai or EMBEDDING_PROVIDER=ollama.",
    );
  }

  const { knowledgeBase, close } = await createKnowledgeBase(config);
  const qaService = new DocumentQaService(knowledgeBase, aiClient);
  const shutdownTasks: Array<() => Promise<void>> = [close];

  if (config.transport === "http") {
    const stopHttpServer = await runHttpServer(config.host, config.port, () =>
      createAppServer(qaService),
      qaService,
      aiClient,
    );
    shutdownTasks.unshift(stopHttpServer);
    console.error(`MCP HTTP server listening on http://${config.host}:${config.port}${MCP_PATH}`);
  } else {
    await runStdioServer(createAppServer(qaService));
  }

  const shutdown = async () => {
    for (const task of shutdownTasks) {
      await task();
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function createAppServer(
  qaService: DocumentQaService,
): McpServer {
  const server = new McpServer({
    name: "doc-qa-mcp",
    version: "0.3.0",
  });

  server.registerTool(
    "health_check",
    {
      title: "Health Check",
      description: "Returns basic server status.",
      inputSchema: {
        name: z.string().optional().describe("Optional caller name"),
      },
    },
    async ({ name }) => {
      const who = name?.trim() || "anonymous";
      return {
        content: [
          {
            type: "text",
            text: `doc-qa-mcp is running. hello ${who}`,
          },
        ],
      };
    },
  );

  registerIndexDocumentsTool(server, qaService);
  registerListSourcesTool(server, qaService);
  registerSearchChunksTool(server, qaService);
  registerAskWithCitationsTool(server, qaService);

  return server;
}

async function runStdioServer(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function runHttpServer(
  host: string,
  port: number,
  serverFactory: () => McpServer,
  qaService: DocumentQaService,
  aiClient: DefaultAiClient,
): Promise<() => Promise<void>> {
  const sessions: SessionMap = {};

  const httpServer = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      if (url.pathname === "/healthz") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (url.pathname === UI_PATH && req.method === "GET") {
        await serveFile(res, path.resolve(process.cwd(), "public/index.html"), "text/html; charset=utf-8");
        return;
      }

      if (url.pathname.startsWith(API_PREFIX)) {
        await handleApiRequest(url.pathname, req, res, qaService, aiClient);
        return;
      }

      if (url.pathname !== MCP_PATH) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }

      if (req.method === "POST") {
        const body = await readJsonBody(req);
        await handleMcpPost(req, res, body, sessions, serverFactory);
        return;
      }

      if (req.method === "GET" || req.method === "DELETE") {
        await handleSessionRequest(req, res, sessions);
        return;
      }

      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : "Internal server error",
          }),
        );
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, host, () => resolve());
    httpServer.once("error", reject);
  });

  return async () => {
    await Promise.all(
      Object.values(sessions).map(async (entry) => {
        await entry.transport.close();
        await entry.server.close();
      }),
    );

    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  };
}

async function handleApiRequest(
  pathname: string,
  req: IncomingMessage,
  res: ServerResponse,
  qaService: DocumentQaService,
  aiClient: DefaultAiClient,
) {
  if (pathname === "/api/sources" && req.method === "GET") {
    const sources = await qaService.listSources();
    writeJson(res, 200, { sources });
    return;
  }

  if (pathname === "/api/index/storage" && req.method === "GET") {
    const storage = await qaService.getIndexStorageInfo();
    writeJson(res, 200, {
      storage,
      persisted: Boolean(storage),
    });
    return;
  }

  if (req.method !== "POST") {
    writeJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const body = await readJsonBody(req);

  if (pathname === "/api/index") {
    const parsed = indexApiSchema.safeParse(body);
    if (!parsed.success) {
      writeJson(res, 400, { error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const result = await qaService.indexDocuments(parsed.data.paths);
    writeJson(res, 200, result);
    return;
  }

  if (pathname === "/api/index/reset") {
    const result = await qaService.resetIndex();
    writeJson(res, 200, result);
    return;
  }

  if (pathname === "/api/index-text") {
    const parsed = indexTextApiSchema.safeParse(body);
    if (!parsed.success) {
      writeJson(res, 400, { error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const result = await qaService.indexRawDocuments(parsed.data.documents);
    writeJson(res, 200, result);
    return;
  }

  if (pathname === "/api/index-upload") {
    const parsed = indexUploadApiSchema.safeParse(body);
    if (!parsed.success) {
      writeJson(res, 400, { error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const result = await qaService.indexUploadedDocuments(
      parsed.data.files.map((file) => ({
        source: file.source,
        contentBase64: file.content_base64,
      })),
    );
    writeJson(res, 200, result);
    return;
  }

  if (pathname === "/api/search") {
    const parsed = searchApiSchema.safeParse(body);
    if (!parsed.success) {
      writeJson(res, 400, { error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const result = await qaService.searchChunks({
      query: parsed.data.query,
      topK: parsed.data.top_k,
      sourceFilter: parsed.data.source_filter,
    });
    writeJson(res, 200, result);
    return;
  }

  if (pathname === "/api/ask") {
    const parsed = askApiSchema.safeParse(body);
    if (!parsed.success) {
      writeJson(res, 400, { error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const result = await qaService.askWithCitations({
      question: parsed.data.question,
      topK: parsed.data.top_k,
      sourceFilter: parsed.data.source_filter,
    });
    writeJson(res, 200, result);
    return;
  }

  if (pathname === "/api/summarize") {
    const parsed = summarizeApiSchema.safeParse(body);
    if (!parsed.success) {
      writeJson(res, 400, { error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    const result = await qaService.summarizeDocuments({
      instruction: parsed.data.instruction,
      sourceFilter: parsed.data.source_filter,
      maxChunks: parsed.data.max_chunks,
    });
    writeJson(res, 200, result);
    return;
  }

  if (pathname === "/api/ask-stream") {
    const parsed = askApiSchema.safeParse(body);
    if (!parsed.success) {
      writeJson(res, 400, { error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }
    await handleAskStream(res, qaService, aiClient, parsed.data);
    return;
  }

  writeJson(res, 404, { error: "API route not found" });
}

async function handleAskStream(
  res: ServerResponse,
  qaService: DocumentQaService,
  aiClient: DefaultAiClient,
  input: {
    question: string;
    top_k?: number;
    source_filter?: string[];
  },
) {
  const startedAt = Date.now();
  writeSseHeaders(res);

  const topK = input.top_k ?? 3;
  if (shouldUseDeterministicStructuredAnswer(input.question)) {
    const deterministic = await qaService.askWithCitations({
      question: input.question,
      topK,
      sourceFilter: input.source_filter,
    });

    writeSse(res, "meta", {
      answer_generation_mode: deterministic.answer_generation_mode,
      retrieval_mode: deterministic.retrieval_mode,
      guidance: deterministic.guidance,
      citations: deterministic.citations,
    });

    writeSse(res, "done", {
      ...deterministic,
      latency_ms: Date.now() - startedAt,
    });
    res.end();
    return;
  }

  const retrieved = await qaService.retrieveForAsk({
    question: input.question,
    topK,
    sourceFilter: input.source_filter,
  });

  const citations = retrieved.hits.map((hit) => ({
    source: hit.source.path,
    chunk_id: hit.chunk.id,
    chunk_index: hit.chunk.index,
    score: Number(hit.score.toFixed(4)),
    snippet: hit.chunk.text.slice(0, 280),
  }));

  writeSse(res, "meta", {
    answer_generation_mode: aiClient.supportsStreamingAnswer() ? "ollama" : "client_llm",
    retrieval_mode: retrieved.retrievalMode,
    guidance: retrieved.guidance,
    citations,
  });

  if (citations.length === 0) {
    writeSse(res, "done", {
      answer:
        "No relevant context was found in indexed documents. Try a more specific question.",
      citations,
      answer_generation_mode: "client_llm",
      retrieval_mode: retrieved.retrievalMode,
      guidance: retrieved.guidance,
      latency_ms: Date.now() - startedAt,
    });
    res.end();
    return;
  }

  if (!aiClient.supportsStreamingAnswer()) {
    const result = await qaService.askWithCitations({
      question: input.question,
      topK,
      sourceFilter: input.source_filter,
    });

    writeSse(res, "done", result);
    res.end();
    return;
  }

  const contexts: RetrievedContext[] = qaService.createGroundingContexts(
    input.question,
    retrieved.hits,
  );

  let answer = "";
  try {
    const generated = await aiClient.streamGroundedAnswer(
      input.question,
      contexts,
      (token) => {
        answer += token;
        writeSse(res, "token", { token });
      },
    );
    if (generated && !answer.trim()) {
      answer = generated;
    }
  } catch (error) {
    writeSse(res, "error", {
      message: error instanceof Error ? error.message : "streaming failed",
    });
  }

  if (!answer.trim()) {
    const fallback = await qaService.askWithCitations({
      question: input.question,
      topK,
      sourceFilter: input.source_filter,
    });
    writeSse(res, "done", fallback);
    res.end();
    return;
  }

  writeSse(res, "done", {
    answer,
    citations,
    answer_generation_mode: "ollama",
    retrieval_mode: retrieved.retrievalMode,
    guidance: retrieved.guidance,
    latency_ms: Date.now() - startedAt,
  });
  res.end();
}

async function handleMcpPost(
  req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
  sessions: SessionMap,
  serverFactory: () => McpServer,
) {
  const sessionId = getSessionId(req);
  const existing = sessionId ? sessions[sessionId] : null;

  if (existing) {
    await existing.transport.handleRequest(req, res, body);
    return;
  }

  if (sessionId && !existing) {
    writeJsonRpcError(res, 404, -32001, "Session not found");
    return;
  }

  if (!isInitializeRequest(body)) {
    writeJsonRpcError(
      res,
      400,
      -32000,
      "Initialize request is required when session is not established",
    );
    return;
  }

  const server = serverFactory();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (newSessionId) => {
      sessions[newSessionId] = { server, transport };
    },
  });

  transport.onclose = () => {
    const closedSessionId = transport.sessionId;
    if (!closedSessionId) {
      return;
    }

    const entry = sessions[closedSessionId];
    if (!entry) {
      return;
    }

    delete sessions[closedSessionId];
    void entry.server.close();
  };

  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

async function handleSessionRequest(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: SessionMap,
) {
  const sessionId = getSessionId(req);
  if (!sessionId || !sessions[sessionId]) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Missing or invalid mcp-session-id");
    return;
  }

  await sessions[sessionId].transport.handleRequest(req, res);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function getSessionId(req: IncomingMessage): string | null {
  const headerValue = req.headers["mcp-session-id"];
  if (!headerValue) {
    return null;
  }
  return Array.isArray(headerValue) ? headerValue[0] : headerValue;
}

function writeJsonRpcError(
  res: ServerResponse,
  httpCode: number,
  code: number,
  message: string,
) {
  res.writeHead(httpCode, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code, message },
      id: null,
    }),
  );
}

function writeJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function writeSseHeaders(res: ServerResponse) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
}

function writeSse(res: ServerResponse, event: string, payload: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function shouldUseDeterministicStructuredAnswer(question: string): boolean {
  const q = question.toLowerCase();
  return (
    /(?:\uBAA9\uB85D|\uC885\uB958|\uD56D\uBAA9|\uBA54\uB274|\uC0AC\uC774\uB4DC\s*\uBA54\uB274|\uD14C\uC774\uBE14|\uC2A4\uD0A4\uB9C8|\uAD6C\uC131|\uAD6C\uC870|\uAC1C\uCCB4)/u.test(
      q,
    ) ||
    /\b(list|types|items|menu|table|schema|structure|entity|erd)\b/.test(q)
  );
}

async function serveFile(
  res: ServerResponse,
  filePath: string,
  contentType: string,
) {
  try {
    const body = await fs.readFile(filePath, "utf-8");
    res.writeHead(200, { "Content-Type": contentType });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}

main().catch((error) => {
  console.error("Failed to start MCP server:", error);
  process.exit(1);
});
