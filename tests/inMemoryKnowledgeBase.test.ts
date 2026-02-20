import { describe, expect, it } from "vitest";
import { InMemoryKnowledgeBase } from "../src/infra/store/inMemoryKnowledgeBase.js";

describe("InMemoryKnowledgeBase hybrid retrieval", () => {
  it("keeps lexical bm25 evidence in hybrid fusion even when semantic points elsewhere", async () => {
    const kb = new InMemoryKnowledgeBase();

    await kb.upsertSource({
      path: "upload://doc-a.txt",
      chunks: [
        {
          index: 0,
          text: "장애 대응 문서. 영향 범위를 먼저 확인한다.",
          embedding: [0, 1],
        },
        {
          index: 1,
          text: "사용자 메뉴 구성은 일정 관리, 주간 보고서, 고객사 관리로 구성된다.",
          embedding: null,
        },
      ],
    });

    const hits = await kb.search({
      query: "메뉴 구성을 알려줘",
      queryEmbedding: [1, 0], // semantic would prefer chunk 0 if only vector is used
      topK: 2,
    });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].chunk.text).toContain("메뉴 구성");
  });
});
