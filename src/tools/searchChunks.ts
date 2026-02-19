import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DocumentQaService } from "../services/documentQaService.js";

export function registerSearchChunksTool(
  server: McpServer,
  qaService: DocumentQaService,
) {
  server.registerTool(
    "search_chunks",
    {
      title: "Search Chunks",
      description: "Retrieves top matching chunks from indexed documents.",
      inputSchema: {
        query: z.string().min(2).describe("Search query"),
        top_k: z.number().int().min(1).max(20).optional().describe("Max hits"),
        source_filter: z
          .array(z.string())
          .optional()
          .describe("Absolute source paths to limit search"),
      },
    },
    async ({ query, top_k, source_filter }) => {
      const result = await qaService.searchChunks({
        query,
        topK: top_k,
        sourceFilter: source_filter,
      });

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
