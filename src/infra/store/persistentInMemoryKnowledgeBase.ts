import { promises as fs } from "node:fs";
import path from "node:path";
import { SearchInput, UpsertSourceInput } from "../../domain/knowledgeBase.js";
import { SearchResult, SourceRecord } from "../../domain/types.js";
import {
  InMemoryKnowledgeBase,
  InMemoryKnowledgeBaseSnapshot,
} from "./inMemoryKnowledgeBase.js";

const CURRENT_FORMAT_VERSION = 1;

interface PersistedKnowledgeBase {
  format_version: number;
  saved_at: string;
  snapshot: InMemoryKnowledgeBaseSnapshot;
}

interface LegacyPersistedKnowledgeBaseV1 {
  version: 1;
  snapshot: InMemoryKnowledgeBaseSnapshot;
}

export interface PersistentInMemoryOptions {
  maxBytes: number;
}

export interface InMemoryIndexStorageInfo {
  path: string;
  exists: boolean;
  format_version: number;
  max_bytes: number;
  size_bytes: number;
  utilization_ratio: number;
}

export class PersistentInMemoryKnowledgeBase extends InMemoryKnowledgeBase {
  private initialized = false;

  private writeChain: Promise<void> = Promise.resolve();

  private readonly absolutePath: string;

  constructor(
    filePath: string,
    private readonly options: PersistentInMemoryOptions,
  ) {
    super();
    this.absolutePath = path.resolve(filePath);
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await fs.mkdir(path.dirname(this.absolutePath), { recursive: true });

    try {
      const raw = await fs.readFile(this.absolutePath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      const snapshot = parseSnapshotFromDisk(parsed);
      this.importSnapshot(snapshot);
    } catch (error) {
      if (!isFileMissing(error)) {
        throw error;
      }
    }

    this.initialized = true;
  }

  async upsertSource(input: UpsertSourceInput): Promise<SourceRecord> {
    await this.initialize();
    const result = await super.upsertSource(input);
    await this.enqueueWrite(async () => {
      await this.persistNow();
    });
    return result;
  }

  async listSources(): Promise<SourceRecord[]> {
    await this.initialize();
    return super.listSources();
  }

  async search(input: SearchInput): Promise<SearchResult[]> {
    await this.initialize();
    return super.search(input);
  }

  async clear(): Promise<{ cleared_sources: number; cleared_chunks: number }> {
    await this.initialize();
    const cleared = await super.clear();
    await this.enqueueWrite(async () => {
      await this.persistNow();
    });
    return cleared;
  }

  async getStorageInfo(): Promise<InMemoryIndexStorageInfo> {
    await this.initialize();
    const stats = await this.readStorageStat();
    return {
      path: this.absolutePath,
      exists: stats.exists,
      format_version: CURRENT_FORMAT_VERSION,
      max_bytes: this.options.maxBytes,
      size_bytes: stats.sizeBytes,
      utilization_ratio:
        this.options.maxBytes > 0 ? Number((stats.sizeBytes / this.options.maxBytes).toFixed(4)) : 0,
    };
  }

  async close(): Promise<void> {
    await this.initialize();
    await this.enqueueWrite(async () => {
      await this.persistNow();
    });
  }

  private enqueueWrite(task: () => Promise<void>): Promise<void> {
    this.writeChain = this.writeChain.then(task, task);
    return this.writeChain;
  }

  private async persistNow(): Promise<void> {
    const payload: PersistedKnowledgeBase = {
      format_version: CURRENT_FORMAT_VERSION,
      saved_at: new Date().toISOString(),
      snapshot: this.exportSnapshot(),
    };

    const serialized = JSON.stringify(payload);
    const bytes = Buffer.byteLength(serialized, "utf-8");
    if (bytes > this.options.maxBytes) {
      throw new Error(
        `In-memory index snapshot exceeds size limit (${bytes} > ${this.options.maxBytes} bytes).`,
      );
    }

    await fs.mkdir(path.dirname(this.absolutePath), { recursive: true });
    const tempPath = `${this.absolutePath}.tmp`;
    await fs.writeFile(tempPath, serialized, "utf-8");
    await replaceFileSafely(tempPath, this.absolutePath, serialized);
  }

  private async readStorageStat(): Promise<{ exists: boolean; sizeBytes: number }> {
    try {
      const stat = await fs.stat(this.absolutePath);
      return { exists: true, sizeBytes: stat.size };
    } catch (error) {
      if (isFileMissing(error)) {
        return { exists: false, sizeBytes: 0 };
      }
      throw error;
    }
  }
}

function isFileMissing(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return "code" in error && (error as { code?: string }).code === "ENOENT";
}

async function replaceFileSafely(
  tempPath: string,
  targetPath: string,
  content: string,
): Promise<void> {
  try {
    await fs.rename(tempPath, targetPath);
    return;
  } catch (error) {
    if (!isReplaceableRenameError(error)) {
      throw error;
    }
  }

  try {
    await fs.rm(targetPath, { force: true });
    await fs.rename(tempPath, targetPath);
    return;
  } catch (error) {
    if (!isReplaceableRenameError(error)) {
      throw error;
    }
  }

  // Last fallback for Windows file-lock edge cases.
  await fs.writeFile(targetPath, content, "utf-8");
  await fs.rm(tempPath, { force: true });
}

function isReplaceableRenameError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (!("code" in error)) {
    return false;
  }

  const code = (error as { code?: string }).code;
  return code === "EPERM" || code === "EEXIST" || code === "EBUSY";
}

function parseSnapshotFromDisk(raw: unknown): InMemoryKnowledgeBaseSnapshot {
  const legacy = parseLegacyV1(raw);
  if (legacy) {
    return legacy.snapshot;
  }

  const current = parseCurrent(raw);
  if (!current) {
    throw new Error("Invalid in-memory index snapshot format.");
  }
  if (current.format_version !== CURRENT_FORMAT_VERSION) {
    throw new Error(
      `Unsupported in-memory index format version: ${current.format_version}. Expected ${CURRENT_FORMAT_VERSION}.`,
    );
  }
  return current.snapshot;
}

function parseLegacyV1(value: unknown): LegacyPersistedKnowledgeBaseV1 | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const v = value as {
    version?: unknown;
    snapshot?: unknown;
  };
  if (v.version !== 1) {
    return null;
  }
  if (!isValidSnapshot(v.snapshot)) {
    return null;
  }
  return { version: 1, snapshot: v.snapshot };
}

function parseCurrent(value: unknown): PersistedKnowledgeBase | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const v = value as {
    format_version?: unknown;
    saved_at?: unknown;
    snapshot?: unknown;
  };
  if (typeof v.format_version !== "number") {
    return null;
  }
  if (typeof v.saved_at !== "string") {
    return null;
  }
  if (!isValidSnapshot(v.snapshot)) {
    return null;
  }
  return {
    format_version: v.format_version,
    saved_at: v.saved_at,
    snapshot: v.snapshot,
  };
}

function isValidSnapshot(value: unknown): value is InMemoryKnowledgeBaseSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }
  const snapshot = value as {
    sources?: unknown;
    chunksBySourceId?: unknown;
  };
  if (!Array.isArray(snapshot.sources)) {
    return false;
  }
  if (!snapshot.chunksBySourceId || typeof snapshot.chunksBySourceId !== "object") {
    return false;
  }
  return true;
}
