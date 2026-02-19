import { RetrievedContext } from "./types.js";

interface OllamaClientOptions {
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;
}

interface OllamaEmbeddingsResponse {
  embedding?: number[];
}

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
}

export class OllamaClient {
  constructor(private readonly options: OllamaClientOptions) {}

  async embedTexts(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    for (const text of texts) {
      const embedding = await this.embedQuery(text);
      embeddings.push(embedding);
    }
    return embeddings;
  }

  async embedQuery(query: string): Promise<number[]> {
    const response = await fetch(`${this.options.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.options.embeddingModel,
        prompt: query,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Ollama embeddings failed (${response.status}): ${await response.text()}`,
      );
    }

    const data = (await response.json()) as OllamaEmbeddingsResponse;
    if (!data.embedding || data.embedding.length === 0) {
      throw new Error("Ollama embeddings returned empty vector.");
    }
    return data.embedding;
  }

  async generateGroundedAnswer(
    question: string,
    contexts: RetrievedContext[],
  ): Promise<string | null> {
    const contextBlock = contexts
      .map(
        (context, idx) =>
          `[${idx + 1}] source=${context.source}#${context.chunkIndex}\n${context.snippet}`,
      )
      .join("\n\n");

    const response = await fetch(`${this.options.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.options.chatModel,
        stream: false,
        messages: [
          {
            role: "system",
            content:
              "You are a strict RAG assistant. Answer only from provided context. If the context is insufficient, say so clearly.",
          },
          {
            role: "user",
            content: `Question:\n${question}\n\nContext:\n${contextBlock}\n\nReturn a concise answer with citations like [1], [2].`,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Ollama chat failed (${response.status}): ${await response.text()}`,
      );
    }

    const data = (await response.json()) as OllamaChatResponse;
    return data.message?.content?.trim() ?? null;
  }
}
