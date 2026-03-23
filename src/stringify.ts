import type { JsonNode, JsonNumberToken, JsonValue } from "./types";

interface SerializeOptions {
  ensureAscii: boolean;
  indentUnit: string;
}

function isNumberToken(value: JsonNode): value is JsonNumberToken {
  return value !== null && typeof value === "object" && "raw" in value && "value" in value;
}

function repeatIndent(indentUnit: string, depth: number): string {
  return indentUnit ? indentUnit.repeat(depth) : "";
}

function escapeString(value: string, ensureAscii: boolean): string {
  let output = "";
  for (const char of value) {
    switch (char) {
      case '"':
        output += '\\"';
        break;
      case "\\":
        output += "\\\\";
        break;
      case "\b":
        output += "\\b";
        break;
      case "\f":
        output += "\\f";
        break;
      case "\n":
        output += "\\n";
        break;
      case "\r":
        output += "\\r";
        break;
      case "\t":
        output += "\\t";
        break;
      default: {
        const code = char.codePointAt(0)!;
        if (code < 0x20 || (ensureAscii && code > 0x7f)) {
          if (code <= 0xffff) {
            output += `\\u${code.toString(16).padStart(4, "0")}`;
          } else {
            const normalized = code - 0x10000;
            const high = 0xd800 + (normalized >> 10);
            const low = 0xdc00 + (normalized & 0x3ff);
            output += `\\u${high.toString(16).padStart(4, "0")}\\u${low.toString(16).padStart(4, "0")}`;
          }
        } else {
          output += char;
        }
      }
    }
  }
  return `"${output}"`;
}

function serialize(value: JsonNode, options: SerializeOptions, depth: number): string {
  if (isNumberToken(value)) {
    return value.raw;
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "null";
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "string") {
    return escapeString(value, options.ensureAscii);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    if (!options.indentUnit) {
      return `[${value.map((item) => serialize(item, options, depth + 1)).join(", ")}]`;
    }
    const innerIndent = repeatIndent(options.indentUnit, depth + 1);
    const outerIndent = repeatIndent(options.indentUnit, depth);
    return `[\n${value.map((item) => `${innerIndent}${serialize(item, options, depth + 1)}`).join(",\n")}\n${outerIndent}]`;
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    return "{}";
  }
  if (!options.indentUnit) {
    return `{${entries
      .map(([key, entryValue]) => `${escapeString(key, options.ensureAscii)}: ${serialize(entryValue, options, depth + 1)}`)
      .join(", ")}}`;
  }

  const innerIndent = repeatIndent(options.indentUnit, depth + 1);
  const outerIndent = repeatIndent(options.indentUnit, depth);
  return `{\n${entries
    .map(([key, entryValue]) => `${innerIndent}${escapeString(key, options.ensureAscii)}: ${serialize(entryValue, options, depth + 1)}`)
    .join(",\n")}\n${outerIndent}}`;
}

export function stringifyJson(value: JsonNode, indent?: number | string, ensureAscii = true): string {
  const indentUnit =
    typeof indent === "number" ? " ".repeat(Math.max(indent, 0)) : typeof indent === "string" ? indent : "";
  return serialize(value, { ensureAscii, indentUnit }, 0);
}

export function unwrapJsonValue(value: JsonNode): JsonValue {
  if (isNumberToken(value)) {
    return value.value as JsonValue;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => unwrapJsonValue(item));
  }
  if (value && typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const [key, entryValue] of Object.entries(value)) {
      result[key] = unwrapJsonValue(entryValue);
    }
    return result;
  }
  return value;
}
