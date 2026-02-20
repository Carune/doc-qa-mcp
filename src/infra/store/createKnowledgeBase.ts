import { AppConfig } from "../../config/env.js";
import { KnowledgeBase } from "../../domain/knowledgeBase.js";
import { createPostgresPool } from "../db/postgres.js";
import { InMemoryKnowledgeBase } from "./inMemoryKnowledgeBase.js";
import { PersistentInMemoryKnowledgeBase } from "./persistentInMemoryKnowledgeBase.js";
import { PgVectorKnowledgeBase } from "./pgVectorKnowledgeBase.js";

export interface KnowledgeBaseBootstrapResult {
  knowledgeBase: KnowledgeBase;
  close: () => Promise<void>;
}

export async function createKnowledgeBase(
  config: AppConfig,
): Promise<KnowledgeBaseBootstrapResult> {
  if (!config.enablePgvector) {
    if (config.persistInMemoryIndex) {
      const knowledgeBase = new PersistentInMemoryKnowledgeBase(
        config.inMemoryIndexPath,
        { maxBytes: config.maxInMemoryIndexBytes },
      );
      await knowledgeBase.initialize();
      return {
        knowledgeBase,
        close: async () => {
          await knowledgeBase.close();
        },
      };
    }

    return {
      knowledgeBase: new InMemoryKnowledgeBase(),
      close: async () => {},
    };
  }

  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required when pgvector is enabled.");
  }

  const pool = createPostgresPool(config.databaseUrl);
  const knowledgeBase = new PgVectorKnowledgeBase(pool, config.vectorDimension);
  await knowledgeBase.initialize();

  return {
    knowledgeBase,
    close: async () => {
      await pool.end();
    },
  };
}
