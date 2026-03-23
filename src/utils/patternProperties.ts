const UNSUPPORTED_REGEX_TOKENS = new Set([".", "^", "$", "*", "+", "?", "{", "}", "[", "]", "|", "(", ")", "\\"]);

export function matchPatternProperties<T>(
  patternProperties: Record<string, T>,
  key: string,
): [matched: T[], unsupported: string[]] {
  if (!patternProperties || Object.keys(patternProperties).length === 0) {
    return [[], []];
  }

  const matched: T[] = [];
  const unsupported: string[] = [];

  for (const [pattern, schema] of Object.entries(patternProperties)) {
    const anchoredStart = pattern.startsWith("^");
    const anchoredEnd = pattern.endsWith("$");
    const literal = pattern.slice(anchoredStart ? 1 : 0, anchoredEnd ? -1 : undefined);

    if ([...literal].some((token) => UNSUPPORTED_REGEX_TOKENS.has(token))) {
      unsupported.push(pattern);
      continue;
    }

    let isMatch = false;
    if (anchoredStart && anchoredEnd) {
      isMatch = key === literal;
    } else if (anchoredStart) {
      isMatch = key.startsWith(literal);
    } else if (anchoredEnd) {
      isMatch = key.endsWith(literal);
    } else {
      isMatch = key.includes(literal);
    }

    if (isMatch) {
      matched.push(schema);
    }
  }

  return [matched, unsupported];
}
