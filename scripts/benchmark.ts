import { promises as fs } from "node:fs";
import path from "node:path";

interface BenchConfig {
  baseUrl: string;
  iterations: number;
  question: string;
  topK: number;
  mode: "ask" | "stream" | "both";
  ensureIndex: boolean;
  saveResults: boolean;
  outputDir: string;
}

interface AskMetrics {
  latencyMs: number;
  answerLength: number;
}

interface StreamMetrics {
  latencyMs: number;
  ttftMs: number;
  tokenCount: number;
  answerLength: number;
}

interface SummaryMetrics {
  runs: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  avgAnswerLength: number;
}

interface StreamSummaryMetrics extends SummaryMetrics {
  avgTtftMs: number;
  p95TtftMs: number;
  avgTokenChars: number;
}

interface SseEventPacket {
  event: string;
  data: unknown;
}

interface BenchmarkReport {
  generatedAt: string;
  config: BenchConfig;
  ask: {
    summary: SummaryMetrics | null;
    runs: AskMetrics[];
  };
  stream: {
    summary: StreamSummaryMetrics | null;
    runs: StreamMetrics[];
  };
}

async function main() {
  const config = loadConfig();
  await ensureHealth(config.baseUrl);

  if (config.ensureIndex) {
    await ensureSampleIndex(config.baseUrl);
  }

  console.log("Benchmark config");
  console.log("================");
  console.log(JSON.stringify(config, null, 2));
  console.log("");

  const askRuns: AskMetrics[] = [];
  const streamRuns: StreamMetrics[] = [];

  if (config.mode === "ask" || config.mode === "both") {
    for (let i = 0; i < config.iterations; i += 1) {
      askRuns.push(
        await runAsk(config.baseUrl, {
          question: config.question,
          top_k: config.topK,
        }),
      );
    }
  }

  if (config.mode === "stream" || config.mode === "both") {
    for (let i = 0; i < config.iterations; i += 1) {
      streamRuns.push(
        await runAskStream(config.baseUrl, {
          question: config.question,
          top_k: config.topK,
        }),
      );
    }
  }

  const askSummary = askRuns.length > 0 ? summarizeAsk(askRuns) : null;
  const streamSummary = streamRuns.length > 0 ? summarizeStream(streamRuns) : null;

  if (askSummary) {
    printAskSummary(askSummary);
  }
  if (streamSummary) {
    printStreamSummary(streamSummary);
  }

  const report: BenchmarkReport = {
    generatedAt: new Date().toISOString(),
    config,
    ask: {
      summary: askSummary,
      runs: askRuns,
    },
    stream: {
      summary: streamSummary,
      runs: streamRuns,
    },
  };

  if (config.saveResults) {
    const saved = await saveReport(report, config.outputDir);
    console.log("Saved benchmark results");
    console.log("=======================");
    console.log(`JSON: ${saved.jsonPath}`);
    console.log(`CSV : ${saved.csvPath}`);
    console.log("");
  }
}

function loadConfig(): BenchConfig {
  const baseUrl = process.env.BENCH_BASE_URL ?? "http://127.0.0.1:3000";
  const iterations = Math.max(1, Number(process.env.BENCH_ITERATIONS ?? "5"));
  const question = (process.env.BENCH_QUESTION ?? "").trim();
  if (!question) {
    throw new Error("BENCH_QUESTION is required. Example: BENCH_QUESTION=\"테이블 목록 알려줘\"");
  }
  const topK = Math.max(1, Number(process.env.BENCH_TOP_K ?? "3"));
  const modeRaw = (process.env.BENCH_MODE ?? "both").toLowerCase();
  const mode: BenchConfig["mode"] =
    modeRaw === "ask" || modeRaw === "stream" || modeRaw === "both"
      ? modeRaw
      : "both";
  const ensureIndex = (process.env.BENCH_INDEX ?? "true").toLowerCase() !== "false";
  const saveResults = (process.env.BENCH_SAVE ?? "true").toLowerCase() !== "false";
  const outputDir = process.env.BENCH_OUTPUT_DIR ?? ".benchmarks";

  return {
    baseUrl,
    iterations,
    question,
    topK,
    mode,
    ensureIndex,
    saveResults,
    outputDir,
  };
}

async function ensureHealth(baseUrl: string): Promise<void> {
  const response = await fetch(`${baseUrl}/healthz`);
  if (!response.ok) {
    throw new Error(`Health check failed: ${response.status}`);
  }
}

async function ensureSampleIndex(baseUrl: string): Promise<void> {
  await fetch(`${baseUrl}/api/index`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paths: ["docs/sample-api.md", "docs/sample-oncall.md"],
    }),
  });
}

async function runAsk(
  baseUrl: string,
  payload: { question: string; top_k: number },
): Promise<AskMetrics> {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const latencyMs = performance.now() - startedAt;

  if (!response.ok) {
    throw new Error(`/api/ask failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as {
    answer?: string;
  };
  return {
    latencyMs,
    answerLength: data.answer?.length ?? 0,
  };
}

async function runAskStream(
  baseUrl: string,
  payload: { question: string; top_k: number },
): Promise<StreamMetrics> {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}/api/ask-stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(
      `/api/ask-stream failed: ${response.status} ${await response.text()}`,
    );
  }
  if (!response.body) {
    throw new Error("/api/ask-stream returned empty body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let ttftMs = -1;
  let tokenCount = 0;
  let answer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const eventEnd = buffer.indexOf("\n\n");
      if (eventEnd < 0) {
        break;
      }

      const rawEvent = buffer.slice(0, eventEnd);
      buffer = buffer.slice(eventEnd + 2);
      const event = parseSseEvent(rawEvent);
      if (!event) {
        continue;
      }

      if (event.event === "token") {
        const data = asRecord(event.data);
        const token = typeof data?.token === "string" ? data.token : "";
        if (token) {
          if (ttftMs < 0) {
            ttftMs = performance.now() - startedAt;
          }
          tokenCount += token.length;
        }
      }

      if (event.event === "done") {
        const data = asRecord(event.data);
        answer = typeof data?.answer === "string" ? data.answer : "";
      }
    }
  }

  const latencyMs = performance.now() - startedAt;
  return {
    latencyMs,
    ttftMs: ttftMs < 0 ? latencyMs : ttftMs,
    tokenCount,
    answerLength: answer.length,
  };
}

function parseSseEvent(rawEvent: string): SseEventPacket | null {
  const lines = rawEvent.split("\n");
  let event = "";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }

  if (!event) {
    return null;
  }

  const rawData = dataLines.join("\n");
  if (!rawData) {
    return { event, data: null };
  }

  try {
    return { event, data: JSON.parse(rawData) as unknown };
  } catch {
    return { event, data: rawData };
  }
}

function asRecord(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  return data as Record<string, unknown>;
}

function summarizeAsk(rows: AskMetrics[]): SummaryMetrics {
  return {
    runs: rows.length,
    avgLatencyMs: average(rows.map((row) => row.latencyMs)),
    p95LatencyMs: percentile(rows.map((row) => row.latencyMs), 95),
    avgAnswerLength: average(rows.map((row) => row.answerLength)),
  };
}

function summarizeStream(rows: StreamMetrics[]): StreamSummaryMetrics {
  return {
    runs: rows.length,
    avgLatencyMs: average(rows.map((row) => row.latencyMs)),
    p95LatencyMs: percentile(rows.map((row) => row.latencyMs), 95),
    avgAnswerLength: average(rows.map((row) => row.answerLength)),
    avgTtftMs: average(rows.map((row) => row.ttftMs)),
    p95TtftMs: percentile(rows.map((row) => row.ttftMs), 95),
    avgTokenChars: average(rows.map((row) => row.tokenCount)),
  };
}

function printAskSummary(summary: SummaryMetrics) {
  console.log("Ask API summary (/api/ask)");
  console.log("===========================");
  console.log(`runs: ${summary.runs}`);
  console.log(`avg_latency_ms: ${summary.avgLatencyMs.toFixed(1)}`);
  console.log(`p95_latency_ms: ${summary.p95LatencyMs.toFixed(1)}`);
  console.log(`avg_answer_length: ${summary.avgAnswerLength.toFixed(1)}`);
  console.log("");
}

function printStreamSummary(summary: StreamSummaryMetrics) {
  console.log("Stream API summary (/api/ask-stream)");
  console.log("====================================");
  console.log(`runs: ${summary.runs}`);
  console.log(`avg_ttft_ms: ${summary.avgTtftMs.toFixed(1)}`);
  console.log(`p95_ttft_ms: ${summary.p95TtftMs.toFixed(1)}`);
  console.log(`avg_latency_ms: ${summary.avgLatencyMs.toFixed(1)}`);
  console.log(`p95_latency_ms: ${summary.p95LatencyMs.toFixed(1)}`);
  console.log(`avg_stream_token_chars: ${summary.avgTokenChars.toFixed(1)}`);
  console.log(`avg_answer_length: ${summary.avgAnswerLength.toFixed(1)}`);
  console.log("");
}

async function saveReport(
  report: BenchmarkReport,
  outputDir: string,
): Promise<{ jsonPath: string; csvPath: string }> {
  const absoluteDir = path.resolve(outputDir);
  await fs.mkdir(absoluteDir, { recursive: true });

  const stamp = toFileStamp(new Date());
  const baseName = `benchmark-${stamp}`;
  const jsonPath = path.join(absoluteDir, `${baseName}.json`);
  const csvPath = path.join(absoluteDir, `${baseName}.csv`);

  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf-8");
  await fs.writeFile(csvPath, buildCsv(report), "utf-8");

  return { jsonPath, csvPath };
}

function buildCsv(report: BenchmarkReport): string {
  const lines: string[] = [];
  lines.push("meta,key,value");
  lines.push(`meta,generated_at,${csvEscape(report.generatedAt)}`);
  lines.push(`meta,base_url,${csvEscape(report.config.baseUrl)}`);
  lines.push(`meta,mode,${csvEscape(report.config.mode)}`);
  lines.push(`meta,iterations,${report.config.iterations}`);
  lines.push(`meta,top_k,${report.config.topK}`);
  lines.push(`meta,question,${csvEscape(report.config.question)}`);
  lines.push("");
  lines.push("type,run,latency_ms,ttft_ms,answer_length,token_chars");

  report.ask.runs.forEach((row, index) => {
    lines.push(
      `ask,${index + 1},${row.latencyMs.toFixed(3)},,${row.answerLength},`,
    );
  });

  report.stream.runs.forEach((row, index) => {
    lines.push(
      `stream,${index + 1},${row.latencyMs.toFixed(3)},${row.ttftMs.toFixed(3)},${row.answerLength},${row.tokenCount}`,
    );
  });

  lines.push("");
  lines.push("summary_type,metric,value");

  if (report.ask.summary) {
    lines.push(`ask,avg_latency_ms,${report.ask.summary.avgLatencyMs.toFixed(3)}`);
    lines.push(`ask,p95_latency_ms,${report.ask.summary.p95LatencyMs.toFixed(3)}`);
    lines.push(`ask,avg_answer_length,${report.ask.summary.avgAnswerLength.toFixed(3)}`);
  }

  if (report.stream.summary) {
    lines.push(`stream,avg_ttft_ms,${report.stream.summary.avgTtftMs.toFixed(3)}`);
    lines.push(`stream,p95_ttft_ms,${report.stream.summary.p95TtftMs.toFixed(3)}`);
    lines.push(`stream,avg_latency_ms,${report.stream.summary.avgLatencyMs.toFixed(3)}`);
    lines.push(`stream,p95_latency_ms,${report.stream.summary.p95LatencyMs.toFixed(3)}`);
    lines.push(`stream,avg_answer_length,${report.stream.summary.avgAnswerLength.toFixed(3)}`);
    lines.push(`stream,avg_token_chars,${report.stream.summary.avgTokenChars.toFixed(3)}`);
  }

  return `\uFEFF${lines.join("\n")}\n`;
}

function toFileStamp(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${y}${m}${d}-${hh}${mm}${ss}-${ms}`;
}

function csvEscape(value: string): string {
  const escaped = value.replaceAll('"', '""');
  return `"${escaped}"`;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const index = Math.min(sorted.length - 1, Math.max(0, rank));
  return sorted[index];
}

main().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
