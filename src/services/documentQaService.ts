import path from "node:path";
import { SearchResult, SourceChunkRecord } from "../domain/types.js";
import { KnowledgeBase } from "../domain/knowledgeBase.js";
import { AiClient, RetrievedContext } from "../infra/ai/types.js";
import { InMemoryIndexStorageInfo } from "../infra/store/persistentInMemoryKnowledgeBase.js";
import {
  getSupportedDocumentExtensions,
  isSupportedDocumentExtension,
  loadDocumentText,
  loadDocumentTextFromBuffer,
} from "../infra/parsers/documentLoader.js";
import { buildAnswerWithCitations, Citation } from "../pipelines/answering.js";
import { splitIntoChunks } from "../pipelines/chunking.js";
import { isBroadQueryIntent, scoreByTokenOverlap } from "../utils/text.js";

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

export interface UploadedDocumentInput {
  source: string;
  contentBase64: string;
}

export interface SearchChunksResult {
  query: string;
  retrieval_mode: "semantic" | "lexical" | "hybrid";
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
  answer_generation_mode: "client_llm" | "ollama";
  retrieval_mode: "semantic" | "lexical" | "hybrid";
  guidance?: string;
  latency_ms: number;
}

export interface ResetIndexResult {
  cleared_sources: number;
  cleared_chunks: number;
}

export interface SummarizeDocumentsResult {
  summary: string;
  citations: Citation[];
  answer_generation_mode: "client_llm" | "ollama";
  source_count: number;
  chunk_count_used: number;
  latency_ms: number;
}

interface RetrievedHits {
  hits: SearchResult[];
  retrievalMode: "semantic" | "lexical" | "hybrid";
  guidance?: string;
}

interface StructuredExtractionResult {
  answer: string;
  citations: Citation[];
}

export class DocumentQaService {
  constructor(
    private readonly knowledgeBase: KnowledgeBase,
    private readonly aiClient: AiClient,
  ) {}

  async indexDocuments(paths: string[]): Promise<IndexDocumentsResult> {
    const failed: FailedIndexing[] = [];
    let indexedCount = 0;
    let chunkCount = 0;

    for (const rawPath of paths) {
      try {
        const absolutePath = path.resolve(rawPath);
        assertSupportedExtension(absolutePath);

        const content = await loadDocumentText(absolutePath);
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
      embedding_enabled: this.aiClient.isEmbeddingConfigured(),
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
      embedding_enabled: this.aiClient.isEmbeddingConfigured(),
      failed,
    };
  }

  async indexUploadedDocuments(documents: UploadedDocumentInput[]): Promise<IndexDocumentsResult> {
    const failed: FailedIndexing[] = [];
    let indexedCount = 0;
    let chunkCount = 0;

    for (let index = 0; index < documents.length; index += 1) {
      const item = documents[index];
      const source = normalizeSourceName(item.source, index);
      try {
        assertSupportedExtension(source);
        const content = await loadDocumentTextFromBuffer(
          source,
          decodeBase64(item.contentBase64),
        );
        if (!content.trim()) {
          throw new Error("Empty content.");
        }

        const saved = await this.indexSingleDocument({
          sourcePath: `upload://${source}`,
          content,
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
      embedding_enabled: this.aiClient.isEmbeddingConfigured(),
      failed,
    };
  }

  async listSources() {
    return this.knowledgeBase.listSources();
  }

  async resetIndex(): Promise<ResetIndexResult> {
    return this.knowledgeBase.clear();
  }

  async getIndexStorageInfo(): Promise<InMemoryIndexStorageInfo | null> {
    if (hasStorageInfo(this.knowledgeBase)) {
      return this.knowledgeBase.getStorageInfo();
    }
    return null;
  }

  async summarizeDocuments(input?: {
    instruction?: string;
    sourceFilter?: string[];
    maxChunks?: number;
  }): Promise<SummarizeDocumentsResult> {
    const startedAt = Date.now();
    const requestedInstruction = input?.instruction?.trim();
    const instruction =
      requestedInstruction && requestedInstruction.length > 0
        ? requestedInstruction
        : "Summarize the full indexed documents. Focus on key entities, data structures, and major actions.";

    const maxChunks = clampMaxChunks(input?.maxChunks);
    const allSources = await this.knowledgeBase.listSources();
    if (allSources.length === 0) {
      return {
        summary: "No indexed sources found. Please index documents first.",
        citations: [],
        answer_generation_mode: "client_llm",
        source_count: 0,
        chunk_count_used: 0,
        latency_ms: Date.now() - startedAt,
      };
    }

    const chunks = await this.knowledgeBase.listChunks({
      sourcePaths: input?.sourceFilter,
      limit: maxChunks,
    });
    if (chunks.length === 0) {
      return {
        summary: "No chunks found for requested sources. Check source_filter values.",
        citations: [],
        answer_generation_mode: "client_llm",
        source_count: 0,
        chunk_count_used: 0,
        latency_ms: Date.now() - startedAt,
      };
    }

    const citations = chunks.slice(0, 12).map((row) => ({
      source: row.source.path,
      chunk_id: row.chunk.id,
      chunk_index: row.chunk.index,
      score: 1,
      snippet: row.chunk.text.slice(0, 280),
    }));

    const uniqueSourceCount = new Set(chunks.map((row) => row.source.path)).size;

    let summary = buildDeterministicSummary(instruction, chunks);
    let answerGenerationMode: "client_llm" | "ollama" = "client_llm";

    if (this.aiClient.getAnswerMode() === "ollama") {
      const contexts = toSummaryContexts(chunks, 28, 12_000);
      if (contexts.length > 0) {
        try {
          const generated = await this.aiClient.generateGroundedAnswer(instruction, contexts);
          if (generated) {
            summary = generated;
            answerGenerationMode = "ollama";
          }
        } catch {
          // Fallback to deterministic summary when local model is unavailable.
        }
      }
    }

    return {
      summary,
      citations,
      answer_generation_mode: answerGenerationMode,
      source_count: uniqueSourceCount,
      chunk_count_used: chunks.length,
      latency_ms: Date.now() - startedAt,
    };
  }

  async searchChunks(input: {
    query: string;
    topK?: number;
    sourceFilter?: string[];
  }): Promise<SearchChunksResult> {
    const sources = await this.knowledgeBase.listSources();
    if (sources.length === 0) {
      return {
        query: input.query,
        retrieval_mode: "lexical",
        guidance: "No indexed sources found. Index documents first using /api/index or /api/index-text.",
        hits: [],
      };
    }

    const retrieved = await this.retrieveHits({
      query: input.query,
      requestedTopK: input.topK,
      sourceFilter: input.sourceFilter,
      mode: "search",
    });

    return {
      query: input.query,
      retrieval_mode: retrieved.retrievalMode,
      guidance: retrieved.guidance,
      hits: retrieved.hits.map((hit) => ({
        score: Number(hit.score.toFixed(4)),
        source: hit.source.path,
        chunk_id: hit.chunk.id,
        chunk_index: hit.chunk.index,
        snippet: hit.chunk.text.slice(0, 240),
      })),
    };
  }

  async retrieveForAsk(input: {
    question: string;
    topK?: number;
    sourceFilter?: string[];
  }): Promise<RetrievedHits> {
    const sources = await this.knowledgeBase.listSources();
    if (sources.length === 0) {
      return {
        hits: [],
        retrievalMode: "lexical",
        guidance:
          "No indexed sources found. Index documents first using /api/index or /api/index-text.",
      };
    }

    return this.retrieveHits({
      query: input.question,
      requestedTopK: input.topK,
      sourceFilter: input.sourceFilter,
      mode: "ask",
    });
  }

  createGroundingContexts(question: string, hits: SearchResult[]): RetrievedContext[] {
    return buildGroundingContexts(question, hits);
  }

  async askWithCitations(input: {
    question: string;
    topK?: number;
    sourceFilter?: string[];
  }): Promise<AskWithCitationsResult> {
    const startedAt = Date.now();
    const sources = await this.knowledgeBase.listSources();
    if (sources.length === 0) {
      return {
        answer: "No indexed sources found. Please index documents first.",
        citations: [],
        answer_generation_mode: "client_llm",
        retrieval_mode: "lexical",
        guidance: "Use /api/index for file paths or /api/index-text for uploaded text documents.",
        latency_ms: Date.now() - startedAt,
      };
    }

    const retrieved = await this.retrieveHits({
      query: input.question,
      requestedTopK: input.topK,
      sourceFilter: input.sourceFilter,
      mode: "ask",
    });

    const defaultResult = buildAnswerWithCitations(input.question, retrieved.hits);
    let answer = defaultResult.answer;
    let citations = defaultResult.citations;
    let usedStructuredExtraction = false;

    const structuredExtraction = await this.buildStructuredExtractionResult(
      input.question,
      retrieved.hits,
      input.sourceFilter,
    );
    if (structuredExtraction) {
      answer = structuredExtraction.answer;
      citations = structuredExtraction.citations;
      usedStructuredExtraction = true;
    }

    let answerGenerationMode: "client_llm" | "ollama" = "client_llm";

    if (
      this.aiClient.getAnswerMode() === "ollama" &&
      retrieved.hits.length > 0 &&
      !usedStructuredExtraction
    ) {
      try {
        const contexts = this.createGroundingContexts(input.question, retrieved.hits);
        if (contexts.length === 0) {
          throw new Error("No grounding contexts available.");
        }
        const generated = await this.aiClient.generateGroundedAnswer(input.question, contexts);

        if (generated) {
          answer = generated;
          answerGenerationMode = "ollama";
        }
      } catch {
        // Fallback to deterministic citation summary when local model fails.
      }
    }

    return {
      answer,
      citations,
      answer_generation_mode: answerGenerationMode,
      retrieval_mode: retrieved.retrievalMode,
      guidance: retrieved.guidance,
      latency_ms: Date.now() - startedAt,
    };
  }

  private async indexSingleDocument(input: { sourcePath: string; content: string }) {
    const chunks = splitIntoChunks(input.content);
    const embeddings = this.aiClient.isEmbeddingConfigured()
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

  private async retrieveHits(input: {
    query: string;
    requestedTopK?: number;
    sourceFilter?: string[];
    mode: "search" | "ask";
  }): Promise<RetrievedHits> {
    const effectiveTopK = resolveTopK(input.query, input.requestedTopK, input.mode);
    const candidateTopK = resolveCandidateTopK(effectiveTopK, input.mode);
    const queryEmbedding = this.aiClient.isEmbeddingConfigured()
      ? await this.aiClient.embedQuery(input.query)
      : null;

    const rawHits = await this.knowledgeBase.search({
      query: input.query,
      queryEmbedding,
      topK: candidateTopK,
      sourcePaths: input.sourceFilter,
    });

    const reranked = rerankHits({
      query: input.query,
      hits: rawHits,
      topK: effectiveTopK,
      hasEmbedding: Boolean(queryEmbedding),
    });

    const expanded = await this.expandHitsWithAdjacentChunks({
      query: input.query,
      hits: reranked,
      sourceFilter: input.sourceFilter,
      targetCount: Math.min(8, Math.max(4, effectiveTopK + 2)),
      hasEmbedding: Boolean(queryEmbedding),
    });

    const retrievalMode = queryEmbedding ? "hybrid" : "lexical";
    return {
      hits: expanded,
      retrievalMode,
      guidance: buildGuidance(retrievalMode, input.query, expanded.length),
    };
  }

  private async expandHitsWithAdjacentChunks(input: {
    query: string;
    hits: SearchResult[];
    sourceFilter?: string[];
    targetCount: number;
    hasEmbedding: boolean;
  }): Promise<SearchResult[]> {
    if (input.hits.length === 0 || input.targetCount <= input.hits.length) {
      return input.hits;
    }

    const sourcePaths = [...new Set(input.hits.map((hit) => hit.source.path))];
    const rows = await this.knowledgeBase.listChunks({
      sourcePaths:
        input.sourceFilter && input.sourceFilter.length > 0
          ? input.sourceFilter
          : sourcePaths,
    });

    if (rows.length === 0) {
      return input.hits;
    }

    const bySourceAndIndex = new Map<string, Map<number, SourceChunkRecord>>();
    for (const row of rows) {
      let sourceMap = bySourceAndIndex.get(row.source.path);
      if (!sourceMap) {
        sourceMap = new Map<number, SourceChunkRecord>();
        bySourceAndIndex.set(row.source.path, sourceMap);
      }
      sourceMap.set(row.chunk.index, row);
    }

    const mergedByChunkId = new Map<string, SearchResult>();
    for (const hit of input.hits) {
      mergedByChunkId.set(hit.chunk.id, hit);
    }

    for (const hit of input.hits) {
      const sourceMap = bySourceAndIndex.get(hit.source.path);
      if (!sourceMap) {
        continue;
      }

      for (const offset of [-1, 1]) {
        const neighbor = sourceMap.get(hit.chunk.index + offset);
        if (!neighbor) {
          continue;
        }
        if (mergedByChunkId.has(neighbor.chunk.id)) {
          continue;
        }

        const lexical = scoreByTokenOverlap(input.query, neighbor.chunk.text);
        const neighborScore = Math.max(hit.score * 0.9, hit.score * 0.45 + lexical * 0.55);
        mergedByChunkId.set(neighbor.chunk.id, {
          source: neighbor.source,
          chunk: neighbor.chunk,
          score: neighborScore,
        });
      }
    }

    return rerankHits({
      query: input.query,
      hits: [...mergedByChunkId.values()],
      topK: input.targetCount,
      hasEmbedding: input.hasEmbedding,
    });
  }

  private async buildStructuredExtractionResult(
    query: string,
    hits: SearchResult[],
    sourceFilter?: string[],
  ): Promise<StructuredExtractionResult | null> {
    if (!isStructuredExtractionQuery(query)) {
      return null;
    }
    if (hits.length === 0) {
      return null;
    }

    const sourcePaths = [
      ...new Set(
        hits
          .map((hit) => hit.source.path)
          .filter((path) => !sourceFilter || sourceFilter.length === 0 || sourceFilter.includes(path)),
      ),
    ];
    if (sourcePaths.length === 0) {
      return null;
    }

    const rows = await this.knowledgeBase.listChunks({
      sourcePaths: sourcePaths.slice(0, 2),
      limit: 260,
    });
    if (rows.length === 0) {
      return null;
    }

    const extracted = extractStructuredLines(query, rows);
    if (extracted.length < 2) {
      return null;
    }

    const topItems = extracted.slice(0, 12);
    const answerLines = [
      `질문: ${query}`,
      "문서에서 추출한 구조 목록:",
      ...topItems.map((item) => `- ${item.text}`),
    ];

    const citationMap = new Map<string, Citation>();
    for (const item of topItems) {
      const key = item.row.chunk.id;
      if (citationMap.has(key)) {
        continue;
      }
      citationMap.set(key, {
        source: item.row.source.path,
        chunk_id: item.row.chunk.id,
        chunk_index: item.row.chunk.index,
        score: Number(item.score.toFixed(4)),
        snippet: item.row.chunk.text.slice(0, 280),
      });
    }

    return {
      answer: answerLines.join("\n"),
      citations: [...citationMap.values()],
    };
  }
}

function hasStorageInfo(
  value: unknown,
): value is { getStorageInfo(): Promise<InMemoryIndexStorageInfo> } {
  return Boolean(
    value &&
      typeof value === "object" &&
      "getStorageInfo" in value &&
      typeof (value as { getStorageInfo?: unknown }).getStorageInfo === "function",
  );
}

function assertSupportedExtension(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (!isSupportedDocumentExtension(filePath)) {
    throw new Error(
      `Unsupported extension: ${ext}. Allowed: ${getSupportedDocumentExtensions().join(", ")}`,
    );
  }
}

function buildGuidance(
  retrievalMode: "semantic" | "lexical" | "hybrid",
  query: string,
  hitCount: number,
): string | undefined {
  if (hitCount > 0) {
    return undefined;
  }

  if (retrievalMode === "semantic" || retrievalMode === "hybrid") {
    return "No relevant chunks found. Try a more specific question or index additional documents.";
  }

  const hasNonLatin = /[^\u0000-\u00ff]/.test(query);
  if (hasNonLatin) {
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

function decodeBase64(value: string): Buffer {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Empty file payload.");
  }
  try {
    return Buffer.from(trimmed, "base64");
  } catch {
    throw new Error("Invalid base64 payload.");
  }
}

function resolveTopK(
  query: string,
  requestedTopK: number | undefined,
  mode: "search" | "ask",
): number {
  const fallback = mode === "ask" ? 3 : 5;
  const base = requestedTopK ?? fallback;

  if (!isBroadQueryIntent(query)) {
    return base;
  }

  // For summary/list/schema-style questions, fetch broader context.
  const broadMinimum = mode === "ask" ? 10 : 15;
  return Math.max(base, broadMinimum);
}

function resolveCandidateTopK(
  finalTopK: number,
  mode: "search" | "ask",
): number {
  const multiplier = mode === "ask" ? 4 : 5;
  const floor = mode === "ask" ? 18 : 24;
  return Math.min(80, Math.max(finalTopK * multiplier, floor));
}

function rerankHits(input: {
  query: string;
  hits: SearchResult[];
  topK: number;
  hasEmbedding: boolean;
}): SearchResult[] {
  if (input.hits.length <= input.topK) {
    return input.hits;
  }

  const broadIntent = isBroadQueryIntent(input.query);
  const minRaw = Math.min(...input.hits.map((hit) => hit.score));
  const maxRaw = Math.max(...input.hits.map((hit) => hit.score));
  const spread = Math.max(1e-9, maxRaw - minRaw);

  const enriched = input.hits.map((hit) => {
    const lexical = scoreByTokenOverlap(input.query, hit.chunk.text);
    const normalizedRaw = (hit.score - minRaw) / spread;
    const sectionBoost =
      broadIntent && hit.chunk.text.toLowerCase().startsWith("[section]") ? 0.06 : 0;

    const combined = input.hasEmbedding
      ? normalizedRaw * 0.65 + lexical * 0.35 + sectionBoost
      : normalizedRaw * 0.85 + lexical * 0.15 + sectionBoost;

    return {
      hit,
      combined,
    };
  });

  const selected: typeof enriched = [];
  const selectedIds = new Set<string>();

  while (selected.length < input.topK) {
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < enriched.length; i += 1) {
      const candidate = enriched[i];
      if (selectedIds.has(candidate.hit.chunk.id)) {
        continue;
      }

      const penalty = computeDiversityPenalty(selected, candidate);
      const finalScore = candidate.combined - penalty;

      if (finalScore > bestScore) {
        bestScore = finalScore;
        bestIndex = i;
      }
    }

    if (bestIndex < 0) {
      break;
    }

    const picked = enriched[bestIndex];
    selected.push(picked);
    selectedIds.add(picked.hit.chunk.id);
  }

  return selected.map((item) => item.hit);
}

function computeDiversityPenalty(
  selected: Array<{
    hit: {
      source: SearchResult["source"];
      chunk: SearchResult["chunk"];
    };
  }>,
  candidate: {
    hit: {
      source: SearchResult["source"];
      chunk: SearchResult["chunk"];
    };
  },
): number {
  const sameSource = selected.filter(
    (item) => item.hit.source.path === candidate.hit.source.path,
  );
  if (sameSource.length === 0) {
    return 0;
  }

  let penalty = Math.min(0.18, sameSource.length * 0.04);
  const adjacent = sameSource.some(
    (item) => Math.abs(item.hit.chunk.index - candidate.hit.chunk.index) <= 1,
  );
  if (adjacent) {
    penalty += 0.02;
  }
  return penalty;
}

function isStructuredExtractionQuery(query: string): boolean {
  const q = query.toLowerCase();
  return (
    /(?:\uBAA9\uB85D|\uC885\uB958|\uD56D\uBAA9|\uBA54\uB274|\uC0AC\uC774\uB4DC\s*\uBA54\uB274|\uD14C\uC774\uBE14|\uC2A4\uD0A4\uB9C8|\uAD6C\uC131|\uAD6C\uC870)/u.test(
      q,
    ) ||
    /\b(list|types|items|menu|table|schema|structure)\b/.test(q)
  );
}

function extractStructuredLines(
  query: string,
  rows: SourceChunkRecord[],
): Array<{ text: string; row: SourceChunkRecord; score: number }> {
  const tableIntent = /(?:\uD14C\uC774\uBE14|\uC2A4\uD0A4\uB9C8|table|schema)/iu.test(query);
  const menuIntent = /(?:\uBA54\uB274|\uC0AC\uC774\uB4DC\s*\uBA54\uB274|menu|navigation)/iu.test(query);
  const listIntent = /(?:\uBAA9\uB85D|\uC885\uB958|\uD56D\uBAA9|list|types|items)/iu.test(query);

  const picked: Array<{ text: string; row: SourceChunkRecord; score: number }> = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const sectionHeader = row.chunk.text.split("\n")[0] ?? "";
    const inMenuSection = /\[section\]\s*\uBA54\uB274\s*\uAD6C\uC131\uB3C4/u.test(sectionHeader);
    const inTableSection = /\[section\]\s*\uD14C\uC774\uBE14/u.test(sectionHeader);

    const lines = row.chunk.text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      if (line.startsWith("[section]")) {
        continue;
      }

      const normalized = line.replace(/\s+/g, " ").trim();
      if (normalized.length < 3) {
        continue;
      }

      const tableLine =
        /^\*/.test(normalized) ||
        /\([A-Z_]{2,}\)/.test(normalized) ||
        /(?:\bID\b|\bid\b)/.test(normalized);
      const menuLine =
        /^-\s*/.test(normalized) ||
        /(?:\uD0D1\uBA54\uB274|\uC0AC\uC774\uB4DC\s*\uBA54\uB274|\uB85C\uADF8\uC778\s*\uD654\uBA74)/u.test(normalized);

      let accept = false;
      if (tableIntent) {
        accept = tableLine || inTableSection;
      } else if (menuIntent) {
        accept = menuLine || inMenuSection;
      } else if (listIntent) {
        accept = tableLine || menuLine || inTableSection || inMenuSection;
      }

      if (!accept) {
        continue;
      }
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);

      let score = scoreByTokenOverlap(query, normalized);
      if (inTableSection && tableLine) {
        score += 0.08;
      }
      if (inMenuSection && menuLine) {
        score += 0.08;
      }
      if (/\([A-Z_]{2,}\)/.test(normalized)) {
        score += 0.03;
      }

      picked.push({ text: normalized, row, score });
    }
  }

  return picked.sort((a, b) => b.score - a.score);
}

function clampMaxChunks(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) {
    return 80;
  }
  return Math.max(10, Math.min(300, Math.floor(value)));
}

function buildDeterministicSummary(
  instruction: string,
  rows: SourceChunkRecord[],
): string {
  const sourceCount = new Set(rows.map((row) => row.source.path)).size;
  const lines: string[] = [
    `Request: ${instruction}`,
    `Scope: ${sourceCount} source(s), ${rows.length} chunk(s)`,
    "Key evidence:",
  ];

  const maxLines = Math.min(8, rows.length);
  for (let i = 0; i < maxLines; i += 1) {
    const row = rows[i];
    const normalized = row.chunk.text.replace(/\s+/g, " ").trim();
    const excerpt = normalized.length > 150 ? `${normalized.slice(0, 147)}...` : normalized;
    lines.push(
      `${i + 1}. ${excerpt} (source: ${row.source.path}#${row.chunk.index})`,
    );
  }

  return lines.join("\n");
}

function buildGroundingContexts(
  question: string,
  hits: SearchResult[],
): RetrievedContext[] {
  if (hits.length === 0) {
    return [];
  }

  const broadIntent = isBroadQueryIntent(question);
  const maxItems = broadIntent ? 8 : 5;
  const minItems = broadIntent ? 4 : 3;
  const maxChars = broadIntent ? 5000 : 3200;
  const maxSnippetChars = broadIntent ? 950 : 700;

  const contexts: RetrievedContext[] = [];
  const seenChunkIds = new Set<string>();
  let usedChars = 0;

  for (const hit of hits) {
    if (contexts.length >= maxItems) {
      break;
    }
    if (seenChunkIds.has(hit.chunk.id)) {
      continue;
    }

    const normalized = hit.chunk.text.replace(/\s+/g, " ").trim();
    if (!normalized) {
      continue;
    }

    const remainingChars = maxChars - usedChars;
    if (remainingChars < 140 && contexts.length >= minItems) {
      break;
    }

    let snippet = normalized.slice(0, maxSnippetChars);
    if (snippet.length > remainingChars) {
      if (remainingChars < 120) {
        continue;
      }
      snippet = snippet.slice(0, remainingChars);
    }

    contexts.push({
      source: hit.source.path,
      chunkIndex: hit.chunk.index,
      snippet,
    });
    seenChunkIds.add(hit.chunk.id);
    usedChars += snippet.length;
  }

  return contexts;
}

function toSummaryContexts(
  rows: SourceChunkRecord[],
  maxItems: number,
  maxChars: number,
): Array<{ source: string; chunkIndex: number; snippet: string }> {
  const contexts: Array<{ source: string; chunkIndex: number; snippet: string }> = [];
  let usedChars = 0;

  for (const row of rows) {
    if (contexts.length >= maxItems) {
      break;
    }

    const snippet = row.chunk.text.replace(/\s+/g, " ").trim().slice(0, 500);
    if (!snippet) {
      continue;
    }

    if (usedChars + snippet.length > maxChars) {
      break;
    }

    contexts.push({
      source: row.source.path,
      chunkIndex: row.chunk.index,
      snippet,
    });
    usedChars += snippet.length;
  }

  return contexts;
}
