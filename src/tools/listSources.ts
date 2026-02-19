import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DocumentQaService } from "../services/documentQaService.js";

export function registerListSourcesTool(
  server: McpServer,
  qaService: DocumentQaService,
) {
  server.registerTool(
    "list_sources",
    {
      title: "List Sources",
      description: "Lists indexed source files and metadata.",
      inputSchema: {},
    },
    async () => {
      const sources = await qaService.listSources();

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
