const WORD_REGEX = /[a-zA-Z0-9가-힣]+/g;

export function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\t/g, " ").trim();
}

export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const words = lower.match(WORD_REGEX) ?? [];
  return words.filter((word) => word.length >= 2);
}

export function scoreByTokenOverlap(query: string, target: string): number {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) {
    return 0;
  }

  const targetTokens = tokenize(target);
  if (targetTokens.length === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of targetTokens) {
    if (queryTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.sqrt(queryTokens.size * targetTokens.length);
}
