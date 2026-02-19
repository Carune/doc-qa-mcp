import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { KnowledgeBase } from "../domain/knowledgeBase.js";
import { OpenAiClient } from "../infra/ai/openAiClient.js";
import { buildAnswerWithCitations } from "../pipelines/answering.js";

export function registerAskWithCitationsTool(
  server: McpServer,
  knowledgeBase: KnowledgeBase,
  aiClient: OpenAiClient,
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
      const queryEmbedding = aiClient.isConfigured()
        ? await aiClient.embedQuery(question)
        : null;
      const hits = await knowledgeBase.search({
        query: question,
        queryEmbedding,
        topK: top_k ?? 3,
        sourcePaths: source_filter,
      });
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
                answer_generation_mode: "client_llm",
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
