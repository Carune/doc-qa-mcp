import { createHash } from "node:crypto";
import { Pool } from "pg";
import {
  KnowledgeBase,
  ListChunksInput,
  SearchInput,
  UpsertSourceInput,
} from "../../domain/knowledgeBase.js";
import { SearchResult, SourceChunkRecord, SourceRecord } from "../../domain/types.js";

interface PgChunkRow {
  chunk_id: string;
  source_id: string;
  chunk_index: number;
  content: string;
  path: string;
  indexed_at: Date;
  chunk_count: number;
  score: number;
}

interface PgSourceChunkRow {
  chunk_id: string;
  source_id: string;
  chunk_index: number;
  content: string;
  path: string;
  indexed_at: Date;
  chunk_count: number;
}

export class PgVectorKnowledgeBase implements KnowledgeBase {
  private initialized = false;

  constructor(
    private readonly pool: Pool,
    private readonly vectorDimension: number,
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        chunk_count INTEGER NOT NULL
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        embedding VECTOR(${this.vectorDimension}) NOT NULL
      )
    `);
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_sources_path ON sources(path)`,
    );
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_chunks_source_id ON chunks(source_id)`,
    );
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_chunks_embedding
      ON chunks USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
    `);

    this.initialized = true;
  }

  async upsertSource(input: UpsertSourceInput): Promise<SourceRecord> {
    await this.initialize();

    const sourceId = createSourceId(input.path);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const sourceResult = await client.query<{
        id: string;
        indexed_at: Date;
        chunk_count: number;
      }>(
        `
          INSERT INTO sources (id, path, indexed_at, chunk_count)
          VALUES ($1, $2, NOW(), $3)
          ON CONFLICT (path)
          DO UPDATE SET indexed_at = NOW(), chunk_count = EXCLUDED.chunk_count
          RETURNING id, indexed_at, chunk_count
        `,
        [sourceId, input.path, input.chunks.length],
      );

      const persistedSourceId = sourceResult.rows[0].id;
      await client.query(`DELETE FROM chunks WHERE source_id = $1`, [
        persistedSourceId,
      ]);

      for (const chunk of input.chunks) {
        if (!chunk.embedding) {
          throw new Error(
            "Missing embedding for pgvector upsert. Configure OPENAI_API_KEY.",
          );
        }

        await client.query(
          `
            INSERT INTO chunks (id, source_id, chunk_index, content, embedding)
            VALUES ($1, $2, $3, $4, $5::vector)
          `,
          [
            `${persistedSourceId}:${chunk.index}`,
            persistedSourceId,
            chunk.index,
            chunk.text,
            toVectorLiteral(chunk.embedding),
          ],
        );
      }

      await client.query("COMMIT");

      return {
        id: persistedSourceId,
        path: input.path,
        indexedAt: sourceResult.rows[0].indexed_at.toISOString(),
        chunkCount: sourceResult.rows[0].chunk_count,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listSources(): Promise<SourceRecord[]> {
    await this.initialize();
    const result = await this.pool.query<{
      id: string;
      path: string;
      indexed_at: Date;
      chunk_count: number;
    }>(`SELECT id, path, indexed_at, chunk_count FROM sources ORDER BY path ASC`);

    return result.rows.map((row) => ({
      id: row.id,
      path: row.path,
      indexedAt: row.indexed_at.toISOString(),
      chunkCount: row.chunk_count,
    }));
  }

  async search(input: SearchInput): Promise<SearchResult[]> {
    await this.initialize();
    if (!input.queryEmbedding) {
      throw new Error(
        "Query embedding is required for pgvector search. Configure OPENAI_API_KEY.",
      );
    }

    const result = await this.pool.query<PgChunkRow>(
      `
        SELECT
          c.id AS chunk_id,
          c.source_id,
          c.chunk_index,
          c.content,
          s.path,
          s.indexed_at,
          s.chunk_count,
          (1 - (c.embedding <=> $1::vector)) AS score
        FROM chunks c
        JOIN sources s ON s.id = c.source_id
        WHERE ($2::text[] IS NULL OR s.path = ANY($2::text[]))
        ORDER BY c.embedding <=> $1::vector
        LIMIT $3
      `,
      [
        toVectorLiteral(input.queryEmbedding),
        input.sourcePaths?.length ? input.sourcePaths : null,
        input.topK,
      ],
    );

    return result.rows.map((row) => ({
      source: {
        id: row.source_id,
        path: row.path,
        indexedAt: row.indexed_at.toISOString(),
        chunkCount: row.chunk_count,
      },
      chunk: {
        id: row.chunk_id,
        sourceId: row.source_id,
        index: row.chunk_index,
        text: row.content,
      },
      score: Number(row.score),
    }));
  }

  async listChunks(input?: ListChunksInput): Promise<SourceChunkRecord[]> {
    await this.initialize();

    const limit = input?.limit && input.limit > 0 ? Math.floor(input.limit) : 100000;
    const result = await this.pool.query<PgSourceChunkRow>(
      `
        SELECT
          c.id AS chunk_id,
          c.source_id,
          c.chunk_index,
          c.content,
          s.path,
          s.indexed_at,
          s.chunk_count
        FROM chunks c
        JOIN sources s ON s.id = c.source_id
        WHERE ($1::text[] IS NULL OR s.path = ANY($1::text[]))
        ORDER BY s.path ASC, c.chunk_index ASC
        LIMIT $2
      `,
      [input?.sourcePaths?.length ? input.sourcePaths : null, limit],
    );

    return result.rows.map((row) => ({
      source: {
        id: row.source_id,
        path: row.path,
        indexedAt: row.indexed_at.toISOString(),
        chunkCount: row.chunk_count,
      },
      chunk: {
        id: row.chunk_id,
        sourceId: row.source_id,
        index: row.chunk_index,
        text: row.content,
      },
    }));
  }

  async clear(): Promise<{ cleared_sources: number; cleared_chunks: number }> {
    await this.initialize();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const sourceCount = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM sources",
      );
      const chunkCount = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM chunks",
      );

      await client.query("TRUNCATE TABLE chunks, sources RESTART IDENTITY");
      await client.query("COMMIT");

      return {
        cleared_sources: Number(sourceCount.rows[0]?.count ?? 0),
        cleared_chunks: Number(chunkCount.rows[0]?.count ?? 0),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function createSourceId(path: string): string {
  return `src_${createHash("sha1").update(path).digest("hex").slice(0, 16)}`;
}

function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}
