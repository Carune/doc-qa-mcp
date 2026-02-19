import { SearchResult, SourceRecord } from "./types.js";

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

export interface KnowledgeBase {
  upsertSource(input: UpsertSourceInput): Promise<SourceRecord>;
  listSources(): Promise<SourceRecord[]>;
  search(input: SearchInput): Promise<SearchResult[]>;
}
