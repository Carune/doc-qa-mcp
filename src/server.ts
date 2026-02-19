import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { InMemoryKnowledgeBase } from "./infra/store/inMemoryKnowledgeBase.js";
import { registerIndexDocumentsTool } from "./tools/indexDocuments.js";
import { registerListSourcesTool } from "./tools/listSources.js";
import { registerSearchChunksTool } from "./tools/searchChunks.js";
import { registerAskWithCitationsTool } from "./tools/askWithCitations.js";

const server = new McpServer({
  name: "doc-qa-mcp",
  version: "0.1.0",
});
const knowledgeBase = new InMemoryKnowledgeBase();

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

registerIndexDocumentsTool(server, knowledgeBase);
registerListSourcesTool(server, knowledgeBase);
registerSearchChunksTool(server, knowledgeBase);
registerAskWithCitationsTool(server, knowledgeBase);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start MCP server:", error);
  process.exit(1);
});
