import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().optional(),
  ENABLE_PGVECTOR: z.enum(["true", "false"]).optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  MCP_HOST: z.string().default("0.0.0.0"),
  MCP_PORT: z.coerce.number().int().positive().default(3000),
  VECTOR_DIMENSION: z.coerce.number().int().positive().default(1536),
});

export interface AppConfig {
  enablePgvector: boolean;
  databaseUrl: string | null;
  openaiApiKey: string | null;
  embeddingModel: string;
  transport: "stdio" | "http";
  host: string;
  port: number;
  vectorDimension: number;
}

export function loadConfig(): AppConfig {
  const parsed = envSchema.parse(process.env);
  const enablePgvector = parsed.ENABLE_PGVECTOR === "true";

  if (enablePgvector && !parsed.DATABASE_URL) {
    throw new Error("ENABLE_PGVECTOR=true requires DATABASE_URL.");
  }

  return {
    enablePgvector,
    databaseUrl: parsed.DATABASE_URL ?? null,
    openaiApiKey: parsed.OPENAI_API_KEY ?? null,
    embeddingModel: parsed.OPENAI_EMBEDDING_MODEL,
    transport: parsed.MCP_TRANSPORT,
    host: parsed.MCP_HOST,
    port: parsed.MCP_PORT,
    vectorDimension: parsed.VECTOR_DIMENSION,
  };
}
