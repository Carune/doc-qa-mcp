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
  embedding?: number[] | null;
}

export interface SearchResult {
  chunk: ChunkRecord;
  source: SourceRecord;
  score: number;
}

export interface SourceChunkRecord {
  source: SourceRecord;
  chunk: ChunkRecord;
}
