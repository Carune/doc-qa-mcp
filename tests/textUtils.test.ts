import { describe, expect, it } from "vitest";
import { isBroadQueryIntent, scoreByTokenOverlap, tokenize } from "../src/utils/text.js";

describe("text utils", () => {
  it("tokenizes unicode words including Korean", () => {
    const tokens = tokenize("\uBA54\uB274 \uAD6C\uC131 \uC5B4\uB5BB\uAC8C \uB418\uC5B4\uC788\uC5B4?");
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens).toContain("\uBA54\uB274");
  });

  it("scores overlap for Korean query/target", () => {
    const score = scoreByTokenOverlap(
      "\uC7A5\uC560 \uB300\uC751 \uCCAB \uB2E8\uACC4",
      "\uC7A5\uC560 \uB300\uC751\uC758 \uCCAB \uB2E8\uACC4\uB294 \uC601\uD5A5 \uBC94\uC704 \uD655\uC778\uC785\uB2C8\uB2E4.",
    );
    expect(score).toBeGreaterThan(0);
  });

  it("matches Korean token variants", () => {
    const score = scoreByTokenOverlap(
      "\uD14C\uC774\uBE14\uB4E4 \uB9D0\uD574\uC918",
      "\uD14C\uC774\uBE14 \uC815\uC758 \uBAA9\uB85D",
    );
    expect(score).toBeGreaterThan(0);
  });

  it("detects broad summary intent in Korean", () => {
    expect(isBroadQueryIntent("\uBB38\uC11C \uC694\uC57D\uD574\uC918")).toBe(true);
  });
});
