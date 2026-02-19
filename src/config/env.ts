import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().optional(),
  ENABLE_PGVECTOR: z.enum(["true", "false"]).optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  OPENAI_CHAT_MODEL: z.string().default("gpt-4o-mini"),
  VECTOR_DIMENSION: z.coerce.number().int().positive().default(1536),
});

export interface AppConfig {
  enablePgvector: boolean;
  databaseUrl: string | null;
  openaiApiKey: string | null;
  embeddingModel: string;
  chatModel: string;
  vectorDimension: number;
}

export function loadConfig(): AppConfig {
  const parsed = envSchema.parse(process.env);
  const enablePgvector =
    parsed.ENABLE_PGVECTOR === "true" || Boolean(parsed.DATABASE_URL);

  if (enablePgvector && !parsed.DATABASE_URL) {
    throw new Error("ENABLE_PGVECTOR=true requires DATABASE_URL.");
  }

  return {
    enablePgvector,
    databaseUrl: parsed.DATABASE_URL ?? null,
    openaiApiKey: parsed.OPENAI_API_KEY ?? null,
    embeddingModel: parsed.OPENAI_EMBEDDING_MODEL,
    chatModel: parsed.OPENAI_CHAT_MODEL,
    vectorDimension: parsed.VECTOR_DIMENSION,
  };
}
