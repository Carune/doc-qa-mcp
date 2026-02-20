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

interface OllamaChatStreamResponse extends OllamaChatResponse {
  done?: boolean;
}

const EMBEDDING_CONCURRENCY = 4;

export class OllamaClient {
  constructor(private readonly options: OllamaClientOptions) {}

  async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const workers = Math.min(EMBEDDING_CONCURRENCY, texts.length);
    const embeddings: number[][] = new Array(texts.length);
    let cursor = 0;

    const runWorker = async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= texts.length) {
          return;
        }
        embeddings[index] = await this.embedQuery(texts[index]);
      }
    };

    await Promise.all(Array.from({ length: workers }, () => runWorker()));
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
    const response = await fetch(`${this.options.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(this.buildChatRequest(question, contexts, false)),
    });

    if (!response.ok) {
      throw new Error(
        `Ollama chat failed (${response.status}): ${await response.text()}`,
      );
    }

    const data = (await response.json()) as OllamaChatResponse;
    return data.message?.content?.trim() ?? null;
  }

  async streamGroundedAnswer(
    question: string,
    contexts: RetrievedContext[],
    onToken: (token: string) => void,
  ): Promise<string | null> {
    const response = await fetch(`${this.options.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(this.buildChatRequest(question, contexts, true)),
    });

    if (!response.ok) {
      throw new Error(
        `Ollama chat stream failed (${response.status}): ${await response.text()}`,
      );
    }

    if (!response.body) {
      throw new Error("Ollama chat stream returned empty body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let collected = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        const data = JSON.parse(trimmed) as OllamaChatStreamResponse;
        const token = data.message?.content ?? "";
        if (token) {
          collected += token;
          onToken(token);
        }
      }
    }

    const tail = decoder.decode();
    if (tail) {
      buffer += tail;
    }
    const finalLine = buffer.trim();
    if (finalLine) {
      const data = JSON.parse(finalLine) as OllamaChatStreamResponse;
      const token = data.message?.content ?? "";
      if (token) {
        collected += token;
        onToken(token);
      }
    }

    return collected.trim() || null;
  }

  private buildChatRequest(
    question: string,
    contexts: RetrievedContext[],
    stream: boolean,
  ) {
    const preferredLanguage = detectPreferredLanguage(question);
    const contextBlock = contexts
      .map(
        (context, idx) =>
          `[${idx + 1}] source=${context.source}#${context.chunkIndex}\n${context.snippet}`,
      )
      .join("\n\n");

    return {
      model: this.options.chatModel,
      stream,
      keep_alive: "30m",
      options: {
        temperature: 0.1,
        num_predict: 220,
        top_p: 0.9,
      },
      messages: [
        {
          role: "system",
          content: [
            "You are a strict RAG assistant.",
            "Answer only from provided context.",
            "If context is insufficient, say it clearly.",
            `Respond only in ${preferredLanguage.label}. Do not mix other languages.`,
            "Keep answer concise (max 6 lines) and include citations like [1], [2].",
          ].join(" "),
        },
        {
          role: "user",
          content: `Question:\n${question}\n\nContext:\n${contextBlock}\n\nOutput rules:\n1) Use only ${preferredLanguage.label}.\n2) Cite evidence as [1], [2].\n3) If unsure, explicitly say you do not have enough context.`,
        },
      ],
    };
  }
}

function detectPreferredLanguage(question: string): { code: string; label: string } {
  if (/[\u3131-\u318E\uAC00-\uD7A3]/.test(question)) {
    return { code: "ko", label: "Korean" };
  }
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(question)) {
    return { code: "ja", label: "Japanese" };
  }
  if (/[\u4E00-\u9FFF]/.test(question)) {
    return { code: "zh", label: "Chinese" };
  }
  if (/[\u00BF\u00A1\u00E1\u00E9\u00ED\u00F3\u00FA\u00F1\u00FC]/i.test(question)) {
    return { code: "es", label: "Spanish" };
  }
  return { code: "en", label: "English" };
}
