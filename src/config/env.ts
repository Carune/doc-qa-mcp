import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().optional(),
  ENABLE_PGVECTOR: z.enum(["true", "false"]).optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  EMBEDDING_PROVIDER: z.enum(["none", "openai", "ollama"]).optional(),
  ANSWER_MODE: z.enum(["client_llm", "ollama"]).default("client_llm"),
  OLLAMA_BASE_URL: z.string().default("http://127.0.0.1:11434"),
  OLLAMA_CHAT_MODEL: z.string().default("qwen2.5:7b-instruct"),
  OLLAMA_EMBEDDING_MODEL: z.string().default("nomic-embed-text"),
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
  embeddingProvider: "none" | "openai" | "ollama";
  answerMode: "client_llm" | "ollama";
  ollamaBaseUrl: string;
  ollamaChatModel: string;
  ollamaEmbeddingModel: string;
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

  const embeddingProvider =
    parsed.EMBEDDING_PROVIDER ??
    (parsed.OPENAI_API_KEY ? "openai" : "none");

  return {
    enablePgvector,
    databaseUrl: parsed.DATABASE_URL ?? null,
    openaiApiKey: parsed.OPENAI_API_KEY ?? null,
    embeddingModel: parsed.OPENAI_EMBEDDING_MODEL,
    embeddingProvider,
    answerMode: parsed.ANSWER_MODE,
    ollamaBaseUrl: parsed.OLLAMA_BASE_URL,
    ollamaChatModel: parsed.OLLAMA_CHAT_MODEL,
    ollamaEmbeddingModel: parsed.OLLAMA_EMBEDDING_MODEL,
    transport: parsed.MCP_TRANSPORT,
    host: parsed.MCP_HOST,
    port: parsed.MCP_PORT,
    vectorDimension: parsed.VECTOR_DIMENSION,
  };
}
