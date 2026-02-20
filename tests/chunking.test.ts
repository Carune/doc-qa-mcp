import { describe, expect, it } from "vitest";
import { splitIntoChunks } from "../src/pipelines/chunking.js";

describe("chunking pipeline", () => {
  it("keeps section context for structured text", () => {
    const text = [
      "<테이블>",
      "*사용자(USER) - 아이디, 비밀번호, 이름",
      "*고객사(CLIENT) - id, 이름, 설명",
      "",
      "<메뉴 구성도>",
      "- 일정 관리",
      "- 주간 보고서",
      "- 고객사 관리",
    ].join("\n");

    const chunks = splitIntoChunks(text, 220, 40);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.some((chunk) => chunk.includes("[section] 테이블"))).toBe(true);
    expect(chunks.some((chunk) => chunk.includes("[section] 메뉴 구성도"))).toBe(true);
  });
});
