import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import "dotenv/config";
import { z } from "zod";
import { loadConfig } from "./config/env.js";
import { OpenAiClient } from "./infra/ai/openAiClient.js";
import { createKnowledgeBase } from "./infra/store/createKnowledgeBase.js";
import { registerIndexDocumentsTool } from "./tools/indexDocuments.js";
import { registerListSourcesTool } from "./tools/listSources.js";
import { registerSearchChunksTool } from "./tools/searchChunks.js";
import { registerAskWithCitationsTool } from "./tools/askWithCitations.js";

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

  const server = new McpServer({
    name: "doc-qa-mcp",
    version: "0.2.0",
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

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    await close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Failed to start MCP server:", error);
  process.exit(1);
});
