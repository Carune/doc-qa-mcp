import {
  KnowledgeBase,
  ListChunksInput,
  SearchInput,
  UpsertSourceInput,
} from "../../domain/knowledgeBase.js";
import {
  ChunkRecord,
  SearchResult,
  SourceChunkRecord,
  SourceRecord,
} from "../../domain/types.js";
import {
  isBroadQueryIntent,
  scoreByTokenOverlap,
  tokenize,
  tokenizeForBm25,
} from "../../utils/text.js";
import { cosineSimilarity } from "../../utils/vector.js";

export interface InMemoryKnowledgeBaseSnapshot {
  sources: SourceRecord[];
  chunksBySourceId: Record<string, ChunkRecord[]>;
}

interface Bm25Document {
  source: SourceRecord;
  chunk: ChunkRecord;
  tf: Map<string, number>;
  uniqueTokens: string[];
  docLength: number;
}

interface Bm25Corpus {
  documents: Bm25Document[];
  docFreq: Map<string, number>;
  avgDocLength: number;
}

export class InMemoryKnowledgeBase implements KnowledgeBase {
  protected sourceByPath = new Map<string, SourceRecord>();

  protected chunkBySourceId = new Map<string, ChunkRecord[]>();

  private bm25DocsBySourceId = new Map<string, Bm25Document[]>();

  private bm25CorpusCache: Bm25Corpus | null = null;

  async upsertSource({ path, chunks }: UpsertSourceInput): Promise<SourceRecord> {
    const existing = this.sourceByPath.get(path);
    const sourceId = existing?.id ?? createSourceId(path);

    const source: SourceRecord = {
      id: sourceId,
      path,
      indexedAt: new Date().toISOString(),
      chunkCount: chunks.length,
    };

    const persistedChunks = chunks.map((chunk) => ({
      id: `${source.id}:${chunk.index}`,
      sourceId: source.id,
      index: chunk.index,
      text: chunk.text,
      embedding: chunk.embedding,
    }));

    this.sourceByPath.set(path, source);
    this.chunkBySourceId.set(source.id, persistedChunks);
    this.bm25DocsBySourceId.set(
      source.id,
      this.buildBm25DocumentsForSource(source, persistedChunks),
    );
    this.bm25CorpusCache = null;

    return source;
  }

  async listSources(): Promise<SourceRecord[]> {
    return [...this.sourceByPath.values()].sort((a, b) =>
      a.path.localeCompare(b.path),
    );
  }

  async listChunks(input?: ListChunksInput): Promise<SourceChunkRecord[]> {
    const allowedSourceIds = this.resolveAllowedSourceIds(input?.sourcePaths);
    const limit = input?.limit && input.limit > 0 ? Math.floor(input.limit) : undefined;

    const sourceRows = [...this.sourceByPath.values()]
      .filter((source) => !allowedSourceIds || allowedSourceIds.has(source.id))
      .sort((a, b) => a.path.localeCompare(b.path));

    const rows: SourceChunkRecord[] = [];
    for (const source of sourceRows) {
      const chunks = [...(this.chunkBySourceId.get(source.id) ?? [])].sort(
        (a, b) => a.index - b.index,
      );

      for (const chunk of chunks) {
        rows.push({ source, chunk });
        if (limit && rows.length >= limit) {
          return rows;
        }
      }
    }

    return rows;
  }

  getSourceByPath(path: string): SourceRecord | undefined {
    return this.sourceByPath.get(path);
  }

  async clear(): Promise<{ cleared_sources: number; cleared_chunks: number }> {
    const clearedSources = this.sourceByPath.size;
    let clearedChunks = 0;
    for (const chunks of this.chunkBySourceId.values()) {
      clearedChunks += chunks.length;
    }

    this.sourceByPath.clear();
    this.chunkBySourceId.clear();
    this.bm25DocsBySourceId.clear();
    this.bm25CorpusCache = null;
    return { cleared_sources: clearedSources, cleared_chunks: clearedChunks };
  }

  async search(input: SearchInput): Promise<SearchResult[]> {
    const allowedSourceIds = this.resolveAllowedSourceIds(input.sourcePaths);

    if (input.queryEmbedding) {
      const hybridResults = this.searchByHybrid(
        input.query,
        input.queryEmbedding,
        input.topK,
        allowedSourceIds,
      );
      if (hybridResults.length > 0) {
        return hybridResults;
      }
    }

    const lexicalResults = this.searchByLexical(input.query, input.topK, allowedSourceIds);
    if (lexicalResults.length > 0) {
      return lexicalResults;
    }

    if (isBroadQueryIntent(input.query)) {
      return this.buildBroadIntentFallback(input.topK, allowedSourceIds);
    }

    return [];
  }

  protected exportSnapshot(): InMemoryKnowledgeBaseSnapshot {
    const sources = [...this.sourceByPath.values()].sort((a, b) =>
      a.path.localeCompare(b.path),
    );

    const chunksBySourceId: Record<string, ChunkRecord[]> = {};
    for (const [sourceId, chunks] of this.chunkBySourceId.entries()) {
      chunksBySourceId[sourceId] = chunks.map((chunk) => ({ ...chunk }));
    }

    return { sources, chunksBySourceId };
  }

  protected importSnapshot(snapshot: InMemoryKnowledgeBaseSnapshot): void {
    this.sourceByPath.clear();
    this.chunkBySourceId.clear();
    this.bm25DocsBySourceId.clear();
    this.bm25CorpusCache = null;

    for (const source of snapshot.sources) {
      this.sourceByPath.set(source.path, { ...source });
    }

    for (const [sourceId, chunks] of Object.entries(snapshot.chunksBySourceId)) {
      this.chunkBySourceId.set(
        sourceId,
        chunks.map((chunk) => ({ ...chunk })),
      );
    }

    this.rebuildBm25Docs();
  }

  private searchBySemantic(
    queryEmbedding: number[],
    topK: number,
    allowedSourceIds: Set<string> | null,
  ): SearchResult[] {
    const candidates: SearchResult[] = [];

    for (const source of this.sourceByPath.values()) {
      if (allowedSourceIds && !allowedSourceIds.has(source.id)) {
        continue;
      }

      const chunks = this.chunkBySourceId.get(source.id) ?? [];
      for (const chunk of chunks) {
        if (!chunk.embedding) {
          continue;
        }
        const score = cosineSimilarity(queryEmbedding, chunk.embedding);
        if (score <= 0) {
          continue;
        }
        candidates.push({ chunk, source, score });
      }
    }

    return candidates.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  private searchByHybrid(
    query: string,
    queryEmbedding: number[],
    topK: number,
    allowedSourceIds: Set<string> | null,
  ): SearchResult[] {
    const semantic = this.searchBySemantic(
      queryEmbedding,
      Math.max(topK, 24),
      allowedSourceIds,
    );
    const bm25 = this.searchByBm25(query, Math.max(topK, 24), allowedSourceIds);

    if (semantic.length === 0) {
      return bm25.slice(0, topK);
    }
    if (bm25.length === 0) {
      return semantic.slice(0, topK);
    }

    return this.fuseByReciprocalRank(semantic, bm25, topK);
  }

  private searchByBm25(
    query: string,
    topK: number,
    allowedSourceIds: Set<string> | null,
  ): SearchResult[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) {
      return [];
    }

    const corpus = this.resolveBm25Corpus(allowedSourceIds);
    if (corpus.documents.length === 0) {
      return [];
    }

    const k1 = 1.2;
    const b = 0.75;

    const scored: SearchResult[] = [];
    for (const doc of corpus.documents) {
      let score = 0;
      for (const term of queryTokens) {
        const tf = doc.tf.get(term) ?? 0;
        if (tf <= 0) {
          continue;
        }
        const df = corpus.docFreq.get(term) ?? 0;
        const idf = Math.log(1 + (corpus.documents.length - df + 0.5) / (df + 0.5));
        const numerator = tf * (k1 + 1);
        const denominator =
          tf + k1 * (1 - b + b * (doc.docLength / Math.max(corpus.avgDocLength, 1e-9)));
        score += idf * (numerator / Math.max(denominator, 1e-9));
      }

      if (score > 0) {
        scored.push({
          source: doc.source,
          chunk: doc.chunk,
          score,
        });
      }
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  private rebuildBm25Docs(): void {
    for (const source of this.sourceByPath.values()) {
      const chunks = this.chunkBySourceId.get(source.id) ?? [];
      this.bm25DocsBySourceId.set(
        source.id,
        this.buildBm25DocumentsForSource(source, chunks),
      );
    }
    this.bm25CorpusCache = null;
  }

  private buildBm25DocumentsForSource(
    source: SourceRecord,
    chunks: ChunkRecord[],
  ): Bm25Document[] {
    const docs: Bm25Document[] = [];

    for (const chunk of chunks) {
      const tokens = tokenizeForBm25(chunk.text);
      if (tokens.length === 0) {
        continue;
      }

      const tf = new Map<string, number>();
      for (const token of tokens) {
        tf.set(token, (tf.get(token) ?? 0) + 1);
      }

      docs.push({
        source,
        chunk,
        tf,
        uniqueTokens: [...new Set(tokens)],
        docLength: tokens.length,
      });
    }

    return docs;
  }

  private resolveBm25Corpus(allowedSourceIds: Set<string> | null): Bm25Corpus {
    if (!allowedSourceIds) {
      if (this.bm25CorpusCache) {
        return this.bm25CorpusCache;
      }

      const documents = [...this.bm25DocsBySourceId.values()].flat();
      const corpus = this.buildBm25Corpus(documents);
      this.bm25CorpusCache = corpus;
      return corpus;
    }

    const documents: Bm25Document[] = [];
    for (const sourceId of allowedSourceIds) {
      const docs = this.bm25DocsBySourceId.get(sourceId);
      if (docs && docs.length > 0) {
        documents.push(...docs);
      }
    }
    return this.buildBm25Corpus(documents);
  }

  private buildBm25Corpus(documents: Bm25Document[]): Bm25Corpus {
    if (documents.length === 0) {
      return {
        documents: [],
        docFreq: new Map<string, number>(),
        avgDocLength: 0,
      };
    }

    const docFreq = new Map<string, number>();
    let totalDocLength = 0;
    for (const doc of documents) {
      totalDocLength += doc.docLength;
      for (const token of doc.uniqueTokens) {
        docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
      }
    }

    return {
      documents,
      docFreq,
      avgDocLength: totalDocLength / documents.length,
    };
  }

  private fuseByReciprocalRank(
    semantic: SearchResult[],
    bm25: SearchResult[],
    topK: number,
  ): SearchResult[] {
    const fused = new Map<
      string,
      {
        source: SourceRecord;
        chunk: ChunkRecord;
        score: number;
      }
    >();

    const rrfK = 60;
    for (let i = 0; i < semantic.length; i += 1) {
      const item = semantic[i];
      const prev = fused.get(item.chunk.id) ?? {
        source: item.source,
        chunk: item.chunk,
        score: 0,
      };
      prev.score += 1 / (rrfK + i + 1);
      fused.set(item.chunk.id, prev);
    }

    for (let i = 0; i < bm25.length; i += 1) {
      const item = bm25[i];
      const prev = fused.get(item.chunk.id) ?? {
        source: item.source,
        chunk: item.chunk,
        score: 0,
      };
      prev.score += 1.05 / (rrfK + i + 1);
      fused.set(item.chunk.id, prev);
    }

    return [...fused.values()]
      .map((item) => ({
        source: item.source,
        chunk: item.chunk,
        score: item.score,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  private searchByLexical(
    query: string,
    topK: number,
    allowedSourceIds: Set<string> | null,
  ): SearchResult[] {
    const candidates: SearchResult[] = [];
    for (const source of this.sourceByPath.values()) {
      if (allowedSourceIds && !allowedSourceIds.has(source.id)) {
        continue;
      }

      const chunks = this.chunkBySourceId.get(source.id) ?? [];
      for (const chunk of chunks) {
        const score = scoreByTokenOverlap(query, chunk.text);
        if (score <= 0) {
          continue;
        }
        candidates.push({ chunk, source, score });
      }
    }

    return candidates.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  private resolveAllowedSourceIds(sourcePaths?: string[]): Set<string> | null {
    if (!sourcePaths || sourcePaths.length === 0) {
      return null;
    }

    const ids = new Set<string>();
    for (const path of sourcePaths) {
      const source = this.sourceByPath.get(path);
      if (source) {
        ids.add(source.id);
      }
    }
    return ids;
  }

  private buildBroadIntentFallback(
    topK: number,
    allowedSourceIds: Set<string> | null,
  ): SearchResult[] {
    const sources = [...this.sourceByPath.values()]
      .filter((source) => !allowedSourceIds || allowedSourceIds.has(source.id))
      .sort((a, b) => a.path.localeCompare(b.path));

    const fallback: SearchResult[] = [];
    for (const source of sources) {
      const chunks = this.chunkBySourceId.get(source.id) ?? [];
      for (const chunk of chunks) {
        fallback.push({
          source,
          chunk,
          score: Number((0.0001 - chunk.index * 0.000001).toFixed(6)),
        });
        if (fallback.length >= topK) {
          return fallback;
        }
      }
    }

    return fallback;
  }
}

function createSourceId(path: string): string {
  const escaped = path.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${escaped}-${suffix}`;
}
