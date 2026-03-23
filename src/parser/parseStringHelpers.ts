import type { JsonRepairParser } from "./JsonRepairParser";
import { ContextValue } from "./context";

export function parseBooleanOrNull(parser: JsonRepairParser): boolean | null | "" {
  const valueMap: Record<string, [string, boolean | null]> = {
    f: ["false", false],
    n: ["null", null],
    t: ["true", true],
  };

  const first = (parser.getCharAt() ?? "").toLowerCase();
  const expected = valueMap[first];
  if (!expected) {
    return "";
  }

  let index = 0;
  const startingIndex = parser.index;
  let char = first;

  while (char && index < expected[0].length && char === expected[0][index]) {
    index += 1;
    parser.index += 1;
    char = (parser.getCharAt() ?? "").toLowerCase();
  }

  if (index === expected[0].length) {
    return expected[1];
  }

  parser.index = startingIndex;
  return "";
}

export function parseJsonLlmBlock(parser: JsonRepairParser) {
  if (parser.source.slice(parser.index, parser.index + 7) === "```json") {
    const offset = parser.skipToCharacter("`", 7);
    if (parser.source.slice(parser.index + offset, parser.index + offset + 3) === "```") {
      parser.index += 7;
      return parser.parseJson();
    }
  }

  return false;
}

export function tryParseSimpleQuotedString(parser: JsonRepairParser): string | undefined {
  if (parser.getCharAt() !== '"') {
    return undefined;
  }

  const start = parser.index + 1;
  const end = parser.source.indexOf('"', start);
  if (end === -1) {
    return undefined;
  }

  const value = parser.source.slice(start, end);
  if (value.includes("\\") || value.includes("\n") || value.includes("\r")) {
    return undefined;
  }

  let nextIndex = end + 1;
  while (nextIndex < parser.source.length && /\s/u.test(parser.source[nextIndex]!)) {
    nextIndex += 1;
  }

  const nextChar = parser.source[nextIndex];
  const currentContext = parser.context.current;
  if (currentContext === ContextValue.ObjectKey) {
    if (nextChar !== ":") {
      return undefined;
    }
  } else if (currentContext === ContextValue.ObjectValue) {
    if (nextChar !== "," && nextChar !== "}" && nextChar !== undefined) {
      return undefined;
    }
  } else if (currentContext === ContextValue.Array) {
    if (nextChar !== "," && nextChar !== "]" && nextChar !== undefined) {
      return undefined;
    }
  } else if (nextChar !== undefined) {
    return undefined;
  }

  parser.index = end + 1;
  return value;
}
