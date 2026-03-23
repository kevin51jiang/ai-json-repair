import type { JsonNode } from "../types";
import type { JsonRepairParser } from "./JsonRepairParser";
import { ContextValue } from "./context";

export function parseComment(parser: JsonRepairParser): JsonNode | "" {
  const char = parser.getCharAt();
  const terminationCharacters = ["\n", "\r"];

  if (parser.context.context.includes(ContextValue.Array)) {
    terminationCharacters.push("]");
  }
  if (parser.context.context.includes(ContextValue.ObjectValue)) {
    terminationCharacters.push("}");
  }
  if (parser.context.context.includes(ContextValue.ObjectKey)) {
    terminationCharacters.push(":");
  }

  if (char === "#") {
    let comment = "";
    let current = parser.getCharAt();
    while (current && !terminationCharacters.includes(current)) {
      comment += current;
      parser.index += 1;
      current = parser.getCharAt();
    }
    parser.log(`Found line comment: ${comment}, ignoring`);
  } else if (char === "/") {
    const nextChar = parser.getCharAt(1);
    if (nextChar === "/") {
      let comment = "//";
      parser.index += 2;
      while (parser.getCharAt() && !terminationCharacters.includes(parser.getCharAt() ?? "")) {
        comment += parser.getCharAt();
        parser.index += 1;
      }
      parser.log(`Found line comment: ${comment}, ignoring`);
    } else if (nextChar === "*") {
      let comment = "/*";
      parser.index += 2;
      while (true) {
        const current = parser.getCharAt();
        if (!current) {
          parser.log("Reached end-of-string while parsing block comment; unclosed block comment.");
          break;
        }

        comment += current;
        parser.index += 1;
        if (comment.endsWith("*/")) {
          break;
        }
      }
      parser.log(`Found block comment: ${comment}, ignoring`);
    } else {
      parser.index += 1;
    }
  }

  if (parser.context.empty) {
    return parser.parseJson();
  }

  return "";
}
