import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { InMemoryKnowledgeBase } from "../infra/store/inMemoryKnowledgeBase.js";
import { buildAnswerWithCitations } from "../pipelines/answering.js";

export function registerAskWithCitationsTool(
  server: McpServer,
  knowledgeBase: InMemoryKnowledgeBase,
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
      const startedAt = Date.now();
      const hits = knowledgeBase.search(question, top_k ?? 3, source_filter);
      const result = buildAnswerWithCitations(question, hits);
      const latencyMs = Date.now() - startedAt;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                answer: result.answer,
                citations: result.citations,
                latency_ms: latencyMs,
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
