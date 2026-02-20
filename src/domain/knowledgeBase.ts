import { SearchResult, SourceChunkRecord, SourceRecord } from "./types.js";

export interface IndexedChunkInput {
  index: number;
  text: string;
  embedding: number[] | null;
}

export interface UpsertSourceInput {
  path: string;
  chunks: IndexedChunkInput[];
}

export interface SearchInput {
  query: string;
  queryEmbedding: number[] | null;
  topK: number;
  sourcePaths?: string[];
}

export interface ListChunksInput {
  sourcePaths?: string[];
  limit?: number;
}

export interface KnowledgeBase {
  upsertSource(input: UpsertSourceInput): Promise<SourceRecord>;
  listSources(): Promise<SourceRecord[]>;
  search(input: SearchInput): Promise<SearchResult[]>;
  listChunks(input?: ListChunksInput): Promise<SourceChunkRecord[]>;
  clear(): Promise<{ cleared_sources: number; cleared_chunks: number }>;
}
