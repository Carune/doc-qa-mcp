import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { InMemoryKnowledgeBase } from "../infra/store/inMemoryKnowledgeBase.js";

export function registerSearchChunksTool(
  server: McpServer,
  knowledgeBase: InMemoryKnowledgeBase,
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
      const hits = knowledgeBase.search(query, top_k ?? 5, source_filter);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                query,
                hits: hits.map((hit) => ({
                  score: Number(hit.score.toFixed(4)),
                  source: hit.source.path,
                  chunk_id: hit.chunk.id,
                  chunk_index: hit.chunk.index,
                  snippet: hit.chunk.text.slice(0, 240),
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
