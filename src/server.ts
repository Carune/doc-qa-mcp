import { randomUUID } from "node:crypto";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import "dotenv/config";
import { z } from "zod";
import { loadConfig } from "./config/env.js";
import { OpenAiClient } from "./infra/ai/openAiClient.js";
import { createKnowledgeBase } from "./infra/store/createKnowledgeBase.js";
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

async function main() {
  const config = loadConfig();
  const aiClient = new OpenAiClient({
    apiKey: config.openaiApiKey,
    embeddingModel: config.embeddingModel,
  });

  if (config.enablePgvector && !aiClient.isConfigured()) {
    throw new Error(
      "pgvector mode requires OPENAI_API_KEY to create query/document embeddings.",
    );
  }

  const { knowledgeBase, close } = await createKnowledgeBase(config);
  const shutdownTasks: Array<() => Promise<void>> = [close];

  if (config.transport === "http") {
    const stopHttpServer = await runHttpServer(config.host, config.port, () =>
      createAppServer(knowledgeBase, aiClient),
    );
    shutdownTasks.unshift(stopHttpServer);
    console.error(`MCP HTTP server listening on http://${config.host}:${config.port}${MCP_PATH}`);
  } else {
    await runStdioServer(createAppServer(knowledgeBase, aiClient));
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
  knowledgeBase: Awaited<
    ReturnType<typeof createKnowledgeBase>
  >["knowledgeBase"],
  aiClient: OpenAiClient,
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

  registerIndexDocumentsTool(server, knowledgeBase, aiClient);
  registerListSourcesTool(server, knowledgeBase);
  registerSearchChunksTool(server, knowledgeBase, aiClient);
  registerAskWithCitationsTool(server, knowledgeBase, aiClient);

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

main().catch((error) => {
  console.error("Failed to start MCP server:", error);
  process.exit(1);
});
