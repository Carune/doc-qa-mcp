import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getSupportedDocumentExtensions,
  isSupportedDocumentExtension,
  loadDocumentText,
} from "../src/infra/parsers/documentLoader.js";

const TMP_DIR = path.resolve(".tmp-tests");
const TMP_TXT = path.join(TMP_DIR, "loader-sample.txt");

describe("documentLoader", () => {
  afterEach(async () => {
    await fs.rm(TMP_TXT, { force: true });
    await fs.rm(TMP_DIR, { recursive: true, force: true });
  });

  it("includes pdf as supported extension", () => {
    expect(getSupportedDocumentExtensions()).toContain(".pdf");
    expect(isSupportedDocumentExtension("manual.pdf")).toBe(true);
  });

  it("loads text file content", async () => {
    await fs.mkdir(TMP_DIR, { recursive: true });
    await fs.writeFile(TMP_TXT, "line 1\r\nline 2", "utf-8");

    const loaded = await loadDocumentText(TMP_TXT);
    expect(loaded).toContain("line 1");
    expect(loaded).toContain("line 2");
  });

  it("rejects unsupported extension", async () => {
    await expect(loadDocumentText("sample.xlsx")).rejects.toThrow("Unsupported extension");
  });
});
