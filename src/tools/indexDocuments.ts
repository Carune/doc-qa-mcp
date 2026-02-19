import { promises as fs } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { KnowledgeBase } from "../domain/knowledgeBase.js";
import { OpenAiClient } from "../infra/ai/openAiClient.js";
import { splitIntoChunks } from "../pipelines/chunking.js";

interface FailedIndexing {
  path: string;
  reason: string;
}

export function registerIndexDocumentsTool(
  server: McpServer,
  knowledgeBase: KnowledgeBase,
  aiClient: OpenAiClient,
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
      const failed: FailedIndexing[] = [];
      let indexedCount = 0;
      let chunkCount = 0;

      for (const rawPath of paths) {
        try {
          const absolutePath = path.resolve(rawPath);
          assertSupportedExtension(absolutePath);

          const content = await fs.readFile(absolutePath, "utf-8");
          const chunks = splitIntoChunks(content);
          const embeddings = aiClient.isConfigured()
            ? await aiClient.embedTexts(chunks)
            : [];

          if (embeddings.length > 0 && embeddings.length !== chunks.length) {
            throw new Error("Embedding count mismatch.");
          }

          await knowledgeBase.upsertSource({
            path: absolutePath,
            chunks: chunks.map((chunk, index) => ({
              index,
              text: chunk,
              embedding: embeddings[index] ?? null,
            })),
          });

          indexedCount += 1;
          chunkCount += chunks.length;
        } catch (error) {
          failed.push({
            path: rawPath,
            reason: error instanceof Error ? error.message : "unknown error",
          });
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                indexed_count: indexedCount,
                chunk_count: chunkCount,
                embedding_enabled: aiClient.isConfigured(),
                failed,
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

function assertSupportedExtension(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  const supported = new Set([".md", ".txt"]);
  if (!supported.has(ext)) {
    throw new Error(`Unsupported extension: ${ext}. Allowed: .md, .txt`);
  }
}
