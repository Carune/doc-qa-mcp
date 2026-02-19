import { ChunkRecord, SearchResult, SourceRecord } from "../../domain/types.js";
import { scoreByTokenOverlap } from "../../utils/text.js";

interface UpsertSourceInput {
  path: string;
  chunks: string[];
}

export class InMemoryKnowledgeBase {
  private sourceByPath = new Map<string, SourceRecord>();

  private chunkBySourceId = new Map<string, ChunkRecord[]>();

  upsertSource({ path, chunks }: UpsertSourceInput): SourceRecord {
    const existing = this.sourceByPath.get(path);
    const sourceId = existing?.id ?? createSourceId(path);

    const source: SourceRecord = {
      id: sourceId,
      path,
      indexedAt: new Date().toISOString(),
      chunkCount: chunks.length,
    };

    this.sourceByPath.set(path, source);
    this.chunkBySourceId.set(
      source.id,
      chunks.map((text, index) => ({
        id: `${source.id}:${index}`,
        sourceId: source.id,
        index,
        text,
      })),
    );

    return source;
  }

  listSources(): SourceRecord[] {
    return [...this.sourceByPath.values()].sort((a, b) =>
      a.path.localeCompare(b.path),
    );
  }

  getSourceByPath(path: string): SourceRecord | undefined {
    return this.sourceByPath.get(path);
  }

  search(query: string, topK: number, sourcePaths?: string[]): SearchResult[] {
    const allowedSourceIds = this.resolveAllowedSourceIds(sourcePaths);

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
}

function createSourceId(path: string): string {
  const escaped = path.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${escaped}-${suffix}`;
}
