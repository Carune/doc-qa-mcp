import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DocumentQaService } from "../services/documentQaService.js";

export function registerIndexDocumentsTool(
  server: McpServer,
  qaService: DocumentQaService,
) {
  server.registerTool(
    "index_documents",
    {
      title: "Index Documents",
      description: "Indexes local markdown/text documents for QA.",
      inputSchema: {
        paths: z.array(z.string()).min(1).describe("File paths to index"),
        force: z.boolean().optional().describe("Reserved for future use"),
      },
    },
    async ({ paths }) => {
      const result = await qaService.indexDocuments(paths);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );
}
