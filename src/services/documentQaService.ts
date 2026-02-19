import { promises as fs } from "node:fs";
import path from "node:path";
import { KnowledgeBase } from "../domain/knowledgeBase.js";
import { OpenAiClient } from "../infra/ai/openAiClient.js";
import { buildAnswerWithCitations, Citation } from "../pipelines/answering.js";
import { splitIntoChunks } from "../pipelines/chunking.js";

export interface FailedIndexing {
  path: string;
  reason: string;
}

export interface IndexDocumentsResult {
  indexed_count: number;
  chunk_count: number;
  embedding_enabled: boolean;
  failed: FailedIndexing[];
}

export interface RawDocumentInput {
  source: string;
  content: string;
}

export interface SearchChunksResult {
  query: string;
  retrieval_mode: "semantic" | "lexical";
  guidance?: string;
  hits: Array<{
    score: number;
    source: string;
    chunk_id: string;
    chunk_index: number;
    snippet: string;
  }>;
}

export interface AskWithCitationsResult {
  answer: string;
  citations: Citation[];
  answer_generation_mode: "client_llm";
  retrieval_mode: "semantic" | "lexical";
  guidance?: string;
  latency_ms: number;
}

export class DocumentQaService {
  constructor(
    private readonly knowledgeBase: KnowledgeBase,
    private readonly aiClient: OpenAiClient,
  ) {}

  async indexDocuments(paths: string[]): Promise<IndexDocumentsResult> {
    const failed: FailedIndexing[] = [];
    let indexedCount = 0;
    let chunkCount = 0;

    for (const rawPath of paths) {
      try {
        const absolutePath = path.resolve(rawPath);
        assertSupportedExtension(absolutePath);

        const content = await fs.readFile(absolutePath, "utf-8");
        const saved = await this.indexSingleDocument({
          sourcePath: absolutePath,
          content,
        });

        indexedCount += 1;
        chunkCount += saved.chunkCount;
      } catch (error) {
        failed.push({
          path: rawPath,
          reason: error instanceof Error ? error.message : "unknown error",
        });
      }
    }

    return {
      indexed_count: indexedCount,
      chunk_count: chunkCount,
      embedding_enabled: this.aiClient.isConfigured(),
      failed,
    };
  }

  async indexRawDocuments(documents: RawDocumentInput[]): Promise<IndexDocumentsResult> {
    const failed: FailedIndexing[] = [];
    let indexedCount = 0;
    let chunkCount = 0;

    for (let index = 0; index < documents.length; index += 1) {
      const item = documents[index];
      const source = normalizeSourceName(item.source, index);
      try {
        if (!item.content.trim()) {
          throw new Error("Empty content.");
        }
        const saved = await this.indexSingleDocument({
          sourcePath: `upload://${source}`,
          content: item.content,
        });
        indexedCount += 1;
        chunkCount += saved.chunkCount;
      } catch (error) {
        failed.push({
          path: source,
          reason: error instanceof Error ? error.message : "unknown error",
        });
      }
    }

    return {
      indexed_count: indexedCount,
      chunk_count: chunkCount,
      embedding_enabled: this.aiClient.isConfigured(),
      failed,
    };
  }

  async listSources() {
    return this.knowledgeBase.listSources();
  }

  async searchChunks(input: {
    query: string;
    topK?: number;
    sourceFilter?: string[];
  }): Promise<SearchChunksResult> {
    const queryEmbedding = this.aiClient.isConfigured()
      ? await this.aiClient.embedQuery(input.query)
      : null;
    const hits = await this.knowledgeBase.search({
      query: input.query,
      queryEmbedding,
      topK: input.topK ?? 5,
      sourcePaths: input.sourceFilter,
    });
    const retrievalMode = queryEmbedding ? "semantic" : "lexical";
    const guidance = buildGuidance(retrievalMode, input.query, hits.length);

    return {
      query: input.query,
      retrieval_mode: retrievalMode,
      guidance,
      hits: hits.map((hit) => ({
        score: Number(hit.score.toFixed(4)),
        source: hit.source.path,
        chunk_id: hit.chunk.id,
        chunk_index: hit.chunk.index,
        snippet: hit.chunk.text.slice(0, 240),
      })),
    };
  }

  async askWithCitations(input: {
    question: string;
    topK?: number;
    sourceFilter?: string[];
  }): Promise<AskWithCitationsResult> {
    const startedAt = Date.now();
    const queryEmbedding = this.aiClient.isConfigured()
      ? await this.aiClient.embedQuery(input.question)
      : null;

    const hits = await this.knowledgeBase.search({
      query: input.question,
      queryEmbedding,
      topK: input.topK ?? 3,
      sourcePaths: input.sourceFilter,
    });

    const result = buildAnswerWithCitations(input.question, hits);
    const retrievalMode = queryEmbedding ? "semantic" : "lexical";
    const guidance = buildGuidance(retrievalMode, input.question, hits.length);

    return {
      answer: result.answer,
      citations: result.citations,
      answer_generation_mode: "client_llm",
      retrieval_mode: retrievalMode,
      guidance,
      latency_ms: Date.now() - startedAt,
    };
  }

  private async indexSingleDocument(input: { sourcePath: string; content: string }) {
    const chunks = splitIntoChunks(input.content);
    const embeddings = this.aiClient.isConfigured()
      ? await this.aiClient.embedTexts(chunks)
      : [];

    if (embeddings.length > 0 && embeddings.length !== chunks.length) {
      throw new Error("Embedding count mismatch.");
    }

    await this.knowledgeBase.upsertSource({
      path: input.sourcePath,
      chunks: chunks.map((chunk, index) => ({
        index,
        text: chunk,
        embedding: embeddings[index] ?? null,
      })),
    });

    return { chunkCount: chunks.length };
  }
}

function assertSupportedExtension(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  const supported = new Set([".md", ".txt"]);
  if (!supported.has(ext)) {
    throw new Error(`Unsupported extension: ${ext}. Allowed: .md, .txt`);
  }
}

function buildGuidance(
  retrievalMode: "semantic" | "lexical",
  query: string,
  hitCount: number,
): string | undefined {
  if (hitCount > 0) {
    return undefined;
  }

  if (retrievalMode === "semantic") {
    return "No relevant chunks found. Try a more specific question or index additional documents.";
  }

  const hasHangul = /[가-힣]/.test(query);
  if (hasHangul) {
    return "No lexical matches. In lexical mode, ask in the same language as indexed documents (e.g., English docs -> English query), or enable semantic mode.";
  }

  return "No lexical matches. Try using exact keywords from the document or enable semantic mode.";
}

function normalizeSourceName(source: string, index: number): string {
  const trimmed = source.trim();
  if (!trimmed) {
    return `uploaded-${index + 1}.txt`;
  }
  return trimmed.replace(/[\\/:*?"<>|]/g, "_");
}
