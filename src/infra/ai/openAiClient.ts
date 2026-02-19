interface OpenAiClientOptions {
  apiKey: string | null;
  embeddingModel: string;
}

interface EmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
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

  private requireApiKey(): string {
    if (!this.options.apiKey) {
      throw new Error("OPENAI_API_KEY is required for OpenAI operations.");
    }
    return this.options.apiKey;
  }
}
