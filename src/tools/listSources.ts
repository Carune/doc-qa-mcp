import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { KnowledgeBase } from "../domain/knowledgeBase.js";

export function registerListSourcesTool(
  server: McpServer,
  knowledgeBase: KnowledgeBase,
) {
  server.registerTool(
    "list_sources",
    {
      title: "List Sources",
      description: "Lists indexed source files and metadata.",
      inputSchema: {},
    },
    async () => {
      const sources = await knowledgeBase.listSources();

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
