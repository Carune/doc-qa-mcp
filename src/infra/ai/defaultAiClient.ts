import { AppConfig } from "../../config/env.js";
import { OpenAiClient } from "./openAiClient.js";
import { OllamaClient } from "./ollamaClient.js";
import { AiClient, RetrievedContext } from "./types.js";

type EmbeddingProvider = "none" | "openai" | "ollama";
type AnswerMode = "client_llm" | "ollama";

export class DefaultAiClient implements AiClient {
  private readonly openAi: OpenAiClient;

  private readonly ollama: OllamaClient;

  private readonly embeddingProvider: EmbeddingProvider;

  private readonly answerMode: AnswerMode;

  constructor(config: AppConfig) {
    this.openAi = new OpenAiClient({
      apiKey: config.openaiApiKey,
      embeddingModel: config.embeddingModel,
    });
    this.ollama = new OllamaClient({
      baseUrl: config.ollamaBaseUrl,
      chatModel: config.ollamaChatModel,
      embeddingModel: config.ollamaEmbeddingModel,
    });
    this.embeddingProvider = config.embeddingProvider;
    this.answerMode = config.answerMode;
  }

  isEmbeddingConfigured(): boolean {
    if (this.embeddingProvider === "none") {
      return false;
    }
    if (this.embeddingProvider === "openai") {
      return this.openAi.isConfigured();
    }
    return true;
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0 || this.embeddingProvider === "none") {
      return [];
    }
    if (this.embeddingProvider === "openai") {
      return this.openAi.embedTexts(texts);
    }
    return this.ollama.embedTexts(texts);
  }

  async embedQuery(query: string): Promise<number[]> {
    if (this.embeddingProvider === "none") {
      throw new Error("Embedding provider is disabled.");
    }
    if (this.embeddingProvider === "openai") {
      return this.openAi.embedQuery(query);
    }
    return this.ollama.embedQuery(query);
  }

  getAnswerMode(): AnswerMode {
    return this.answerMode;
  }

  supportsStreamingAnswer(): boolean {
    return this.answerMode === "ollama";
  }

  async generateGroundedAnswer(
    question: string,
    contexts: RetrievedContext[],
  ): Promise<string | null> {
    if (this.answerMode !== "ollama") {
      return null;
    }
    return this.ollama.generateGroundedAnswer(question, contexts);
  }

  async streamGroundedAnswer(
    question: string,
    contexts: RetrievedContext[],
    onToken: (token: string) => void,
  ): Promise<string | null> {
    if (this.answerMode !== "ollama") {
      return null;
    }
    return this.ollama.streamGroundedAnswer(question, contexts, onToken);
  }
}
