import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DocumentQaService } from "../services/documentQaService.js";

export function registerAskWithCitationsTool(
  server: McpServer,
  qaService: DocumentQaService,
) {
  server.registerTool(
    "ask_with_citations",
    {
      title: "Ask With Citations",
      description: "Answers a question and returns supporting chunks.",
      inputSchema: {
        question: z.string().min(2).describe("Question for the indexed docs"),
        top_k: z.number().int().min(1).max(10).optional().describe("Retrieval size"),
        source_filter: z
          .array(z.string())
          .optional()
          .describe("Absolute source paths to limit retrieval"),
      },
    },
    async ({ question, top_k, source_filter }) => {
      const result = await qaService.askWithCitations({
        question,
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
