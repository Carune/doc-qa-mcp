export interface SourceRecord {
  id: string;
  path: string;
  indexedAt: string;
  chunkCount: number;
}

export interface ChunkRecord {
  id: string;
  sourceId: string;
  index: number;
  text: string;
}

export interface SearchResult {
  chunk: ChunkRecord;
  source: SourceRecord;
  score: number;
}
