import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PersistentInMemoryKnowledgeBase } from "../src/infra/store/persistentInMemoryKnowledgeBase.js";

const TEMP_DIR = path.resolve(".tmp-tests-persistent");
const TEMP_FILE = path.join(TEMP_DIR, "persistent-kb-test.json");

describe("PersistentInMemoryKnowledgeBase", () => {
  afterEach(async () => {
    await fs.rm(TEMP_FILE, { force: true });
    await fs.rm(TEMP_DIR, { recursive: true, force: true });
  });

  it("restores indexed sources after restart", async () => {
    const kb1 = new PersistentInMemoryKnowledgeBase(TEMP_FILE, {
      maxBytes: 1_000_000,
    });
    await kb1.initialize();
    await kb1.upsertSource({
      path: "upload://weekly.txt",
      chunks: [
        {
          index: 0,
          text: "Weekly report table includes user and project fields.",
          embedding: [0.1, 0.2, 0.3],
        },
      ],
    });
    await kb1.close();

    const kb2 = new PersistentInMemoryKnowledgeBase(TEMP_FILE, {
      maxBytes: 1_000_000,
    });
    await kb2.initialize();

    const sources = await kb2.listSources();
    expect(sources).toHaveLength(1);
    expect(sources[0].path).toContain("weekly.txt");

    const semanticHits = await kb2.search({
      query: "weekly report",
      queryEmbedding: [0.1, 0.2, 0.3],
      topK: 3,
    });
    expect(semanticHits.length).toBeGreaterThan(0);
  });

  it("enforces max index file size", async () => {
    const kb = new PersistentInMemoryKnowledgeBase(TEMP_FILE, {
      maxBytes: 120,
    });
    await kb.initialize();

    await expect(
      kb.upsertSource({
        path: "upload://oversize.txt",
        chunks: [
          {
            index: 0,
            text: "A".repeat(200),
            embedding: null,
          },
        ],
      }),
    ).rejects.toThrow("exceeds size limit");
  });
});
