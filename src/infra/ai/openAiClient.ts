interface OpenAiClientOptions {
  apiKey: string | null;
  embeddingModel: string;
  chatModel: string;
}

interface EmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
}

interface ChatResponse {
  choices: Array<{
    message: {
      content: string | null;
    };
  }>;
}

export class OpenAiClient {
  constructor(private readonly options: OpenAiClientOptions) {}

  isConfigured(): boolean {
    return Boolean(this.options.apiKey);
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const apiKey = this.requireApiKey();

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.options.embeddingModel,
        input: texts,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `OpenAI embeddings failed (${response.status}): ${await response.text()}`,
      );
    }

    const data = (await response.json()) as EmbeddingResponse;
    return data.data
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  }

  async embedQuery(query: string): Promise<number[]> {
    const [embedding] = await this.embedTexts([query]);
    return embedding;
  }

  async generateGroundedAnswer(question: string, contexts: ContextItem[]) {
    const apiKey = this.requireApiKey();
    const contextBlock = contexts
      .map(
        (context, idx) =>
          `[${idx + 1}] source=${context.source}#${context.chunkIndex}\n${context.snippet}`,
      )
      .join("\n\n");

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.options.chatModel,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You are a strict RAG assistant. Answer only from provided context. If context is insufficient, say so clearly.",
          },
          {
            role: "user",
            content: `Question:\n${question}\n\nContext:\n${contextBlock}\n\nWrite a concise answer and cite like [1], [2].`,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(
        `OpenAI chat failed (${response.status}): ${await response.text()}`,
      );
    }

    const data = (await response.json()) as ChatResponse;
    return data.choices[0]?.message?.content?.trim() ?? "";
  }

  private requireApiKey(): string {
    if (!this.options.apiKey) {
      throw new Error("OPENAI_API_KEY is required for OpenAI operations.");
    }
    return this.options.apiKey;
  }
}

export interface ContextItem {
  source: string;
  chunkIndex: number;
  snippet: string;
}
