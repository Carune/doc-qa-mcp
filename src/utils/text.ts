const WORD_REGEX = /[\p{L}\p{N}]+/gu;

const KOREAN_SUFFIXES = [
  "\uC73C\uB85C", // 으로
  "\uC5D0\uC11C", // 에서
  "\uAC8C", // 게
  "\uBD80\uD130", // 부터
  "\uAE4C\uC9C0", // 까지
  "\uCC98\uB7FC", // 처럼
  "\uC73C\uB85C\uC11C", // 으로서
  "\uC73C\uB85C\uC368", // 으로써
  "\uB294", // 는
  "\uC740", // 은
  "\uC774", // 이
  "\uAC00", // 가
  "\uC744", // 을
  "\uB97C", // 를
  "\uC5D0", // 에
  "\uC758", // 의
  "\uACFC", // 과
  "\uC640", // 와
  "\uB9CC", // 만
  "\uB85C", // 로
];

export function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\t/g, " ").trim();
}

export function tokenize(text: string): string[] {
  return [...new Set(tokenizeForBm25(text))];
}

export function tokenizeForBm25(text: string): string[] {
  const lower = text.toLowerCase();
  const words = lower.match(WORD_REGEX) ?? [];

  const expanded: string[] = [];
  for (const word of words) {
    expanded.push(...expandTokenVariants(word));
  }

  return expanded;
}

export function scoreByTokenOverlap(query: string, target: string): number {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) {
    return 0;
  }

  const targetTokens = new Set(tokenize(target));
  if (targetTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of queryTokens) {
    if (targetTokens.has(token)) {
      overlap += 1;
    }
  }

  const tokenScore = overlap / Math.sqrt(queryTokens.size * targetTokens.size);
  const ngramScore = scoreByCharNgramJaccard(query, target);

  return Math.max(tokenScore, ngramScore * 0.85);
}

export function isBroadQueryIntent(query: string): boolean {
  const q = query.toLowerCase();

  const ko =
    /(?:\uC694\uC57D|\uC815\uB9AC|\uAC1C\uC694|\uC804\uCCB4|\uC124\uBA85|\uAD6C\uC131|\uAD6C\uC870|\uBAA9\uB85D|\uD14C\uC774\uBE14|\uC2A4\uD0A4\uB9C8|\uBA54\uB274|\uD56D\uBAA9|\uB9D0\uD574\uC918|\uBCF4\uC5EC\uC918)/u;
  const en =
    /\b(summary|summarize|overview|list|table|schema|structure|menu|explain|describe)\b/;

  return ko.test(q) || en.test(q);
}

function expandTokenVariants(token: string): string[] {
  const trimmed = token.trim();
  if (!trimmed) {
    return [];
  }

  const hasNonAscii = /[^\x00-\x7f]/.test(trimmed);
  const variants = new Set<string>();
  variants.add(trimmed);

  if (hasNonAscii) {
    if (trimmed.length >= 2) {
      for (const suffix of KOREAN_SUFFIXES) {
        if (trimmed.endsWith(suffix) && trimmed.length > suffix.length + 1) {
          variants.add(trimmed.slice(0, -suffix.length));
        }
      }
    }
  } else if (trimmed.length >= 4 && trimmed.endsWith("s")) {
    variants.add(trimmed.slice(0, -1));
  }

  return [...variants].filter((word) => {
    const hasUnicode = /[^\x00-\x7f]/.test(word);
    return hasUnicode ? word.length >= 1 : word.length >= 2;
  });
}

function scoreByCharNgramJaccard(query: string, target: string): number {
  const qNgrams = buildCharNgrams(query, 2);
  const tNgrams = buildCharNgrams(target.slice(0, 1200), 2);

  if (qNgrams.size === 0 || tNgrams.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const item of qNgrams) {
    if (tNgrams.has(item)) {
      intersection += 1;
    }
  }

  const union = qNgrams.size + tNgrams.size - intersection;
  if (union <= 0) {
    return 0;
  }
  return intersection / union;
}

function buildCharNgrams(input: string, n: number): Set<string> {
  const normalized = normalizeText(input)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");

  if (normalized.length < n) {
    return new Set();
  }

  const grams = new Set<string>();
  for (let i = 0; i <= normalized.length - n; i += 1) {
    grams.add(normalized.slice(i, i + n));
  }
  return grams;
}
