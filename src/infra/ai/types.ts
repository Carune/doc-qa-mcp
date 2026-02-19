export interface RetrievedContext {
  source: string;
  chunkIndex: number;
  snippet: string;
}

export interface AiClient {
  isEmbeddingConfigured(): boolean;
  embedTexts(texts: string[]): Promise<number[][]>;
  embedQuery(query: string): Promise<number[]>;
  getAnswerMode(): "client_llm" | "ollama";
  generateGroundedAnswer(
    question: string,
    contexts: RetrievedContext[],
  ): Promise<string | null>;
}
