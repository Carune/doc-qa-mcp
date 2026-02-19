import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryKnowledgeBase } from "../infra/store/inMemoryKnowledgeBase.js";

export function registerListSourcesTool(
  server: McpServer,
  knowledgeBase: InMemoryKnowledgeBase,
) {
  server.registerTool(
    "list_sources",
    {
      title: "List Sources",
      description: "Lists indexed source files and metadata.",
      inputSchema: {},
    },
    async () => {
      const sources = knowledgeBase.listSources();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ sources }, null, 2),
          },
        ],
      };
    },
  );
}
