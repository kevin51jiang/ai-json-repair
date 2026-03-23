import type { JsonNode, JsonNumberToken } from "../types";
import type { JsonRepairParser } from "./JsonRepairParser";
import { ContextValue } from "./context";

const NUMBER_CHARS = new Set("0123456789-.eE/,_".split(""));

function toNumberToken(numberString: string): JsonNumberToken | string {
  if (numberString.includes(",")) {
    return numberString;
  }

  if (/^-?\d+$/u.test(numberString)) {
    try {
      const value = BigInt(numberString);
      if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
        return {
          raw: numberString,
          value,
        };
      }

      return {
        raw: numberString,
        value: Number(numberString),
      };
    } catch {
      return numberString;
    }
  }

  const value = Number(numberString);
  if (Number.isNaN(value)) {
    return numberString;
  }

  let raw = String(value);
  if (numberString.endsWith(".") && !raw.includes(".")) {
    raw = `${raw}.0`;
  }
  if (/[eE]/u.test(numberString) && Number.isFinite(value) && Number.isInteger(value)) {
    raw = value.toFixed(1);
  }

  return {
    raw,
    value,
  };
}

export function parseNumber(parser: JsonRepairParser): JsonNode {
  let numberString = "";
  let char = parser.getCharAt();
  const isArray = parser.context.current === ContextValue.Array;

  while (char && NUMBER_CHARS.has(char) && (!isArray || char !== ",")) {
    if (char !== "_") {
      numberString += char;
    }
    parser.index += 1;
    char = parser.getCharAt();
  }

  if ((parser.getCharAt() ?? "").match(/[A-Za-z]/u)) {
    parser.index -= numberString.length;
    return parser.parseString();
  }

  if (numberString && /[-eE/,]$/u.test(numberString)) {
    numberString = numberString.slice(0, -1);
    parser.index -= 1;
  }

  if (numberString === "") {
    return "";
  }

  return toNumberToken(numberString);
}
