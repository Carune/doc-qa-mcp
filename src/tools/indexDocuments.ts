import { promises as fs } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { InMemoryKnowledgeBase } from "../infra/store/inMemoryKnowledgeBase.js";
import { splitIntoChunks } from "../pipelines/chunking.js";

interface FailedIndexing {
  path: string;
  reason: string;
}

export function registerIndexDocumentsTool(
  server: McpServer,
  knowledgeBase: InMemoryKnowledgeBase,
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

          knowledgeBase.upsertSource({
            path: absolutePath,
            chunks,
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
