import type { JsonNode } from "../types";
import type { JsonRepairParser } from "./JsonRepairParser";
import { STRING_DELIMITERS } from "./constants";
import { ContextValue } from "./context";
import { parseBooleanOrNull, parseJsonLlmBlock, tryParseSimpleQuotedString } from "./parseStringHelpers";

function onlyWhitespaceUntil(parser: JsonRepairParser, end: number): boolean {
  for (let index = 1; index < end; index += 1) {
    const char = parser.getCharAt(index);
    if (char !== undefined && !/\s/u.test(char)) {
      return false;
    }
  }
  return true;
}

export function parseString(parser: JsonRepairParser): JsonNode {
  const appendLiteralChar = (accumulator: string, currentChar: string): [string, string | undefined] => {
    const nextAccumulator = accumulator + currentChar;
    parser.index += 1;
    return [nextAccumulator, parser.getCharAt()];
  };

  let missingQuotes = false;
  let doubledQuotes = false;
  let leftDelimiter = '"';
  let rightDelimiter = '"';

  let char = parser.getCharAt();
  if (char === "#" || char === "/") {
    return parser.parseComment();
  }

  while (char && !STRING_DELIMITERS.includes(char as (typeof STRING_DELIMITERS)[number]) && !/[A-Za-z0-9]/u.test(char)) {
    parser.index += 1;
    char = parser.getCharAt();
  }

  if (!char) {
    return "";
  }

  const fastPathValue = tryParseSimpleQuotedString(parser);
  if (fastPathValue !== undefined) {
    return fastPathValue;
  }

  if (char === "'") {
    leftDelimiter = "'";
    rightDelimiter = "'";
  } else if (char === "“") {
    leftDelimiter = "“";
    rightDelimiter = "”";
  } else if (/[A-Za-z0-9]/u.test(char)) {
    if (["t", "f", "n"].includes(char.toLowerCase()) && parser.context.current !== ContextValue.ObjectKey) {
      const value = parseBooleanOrNull(parser);
      if (value !== "") {
        return value;
      }
    }

    parser.log("While parsing a string, we found a literal instead of a quote");
    missingQuotes = true;
  }

  if (!missingQuotes) {
    parser.index += 1;
  }

  if (parser.getCharAt() === "`") {
    const value = parseJsonLlmBlock(parser);
    if (value !== false) {
      return value;
    }
    parser.log(
      "While parsing a string, we found code fences but they did not enclose valid JSON, continuing parsing the string",
    );
  }

  if (parser.getCharAt() === leftDelimiter) {
    if (
      (parser.context.current === ContextValue.ObjectKey && parser.getCharAt(1) === ":") ||
      (parser.context.current === ContextValue.ObjectValue &&
        [",", "}"].includes(parser.getCharAt(1) ?? "")) ||
      (parser.context.current === ContextValue.Array && [",", "]"].includes(parser.getCharAt(1) ?? ""))
    ) {
      parser.index += 1;
      return "";
    }

    if (parser.getCharAt(1) === leftDelimiter) {
      parser.log("While parsing a string, we found a doubled quote and then a quote again, ignoring it");
      if (parser.strict) {
        throw new Error("Found doubled quotes followed by another quote.");
      }
      return "";
    }

    let offset = parser.skipToCharacter(rightDelimiter, 1);
    let nextChar = parser.getCharAt(offset);
    if (parser.getCharAt(offset + 1) === rightDelimiter) {
      parser.log("While parsing a string, we found a valid starting doubled quote");
      doubledQuotes = true;
      parser.index += 1;
    } else {
      offset = parser.scrollWhitespaces(1);
      nextChar = parser.getCharAt(offset);
      if ([...STRING_DELIMITERS, "{", "["].includes((nextChar ?? "") as never)) {
        parser.log(
          "While parsing a string, we found a doubled quote but also another quote afterwards, ignoring it",
        );
        if (parser.strict) {
          throw new Error("Found doubled quotes followed by another quote while parsing a string.");
        }
        parser.index += 1;
        return "";
      }
      if (nextChar !== "," && nextChar !== "]" && nextChar !== "}") {
        parser.log("While parsing a string, we found a doubled quote but it was a mistake, removing one quote");
        parser.index += 1;
      }
    }
  }

  let stringAccumulator = "";
  char = parser.getCharAt();
  let unmatchedDelimiter = false;

  while (char && char !== rightDelimiter) {
    if (missingQuotes) {
      if (parser.context.current === ContextValue.ObjectKey && (char === ":" || /\s/u.test(char))) {
        parser.log(
          "While parsing a string missing the left delimiter in object key context, we found a :, stopping here",
        );
        break;
      }
      if (parser.context.current === ContextValue.Array && (char === "]" || char === ",")) {
        parser.log(
          "While parsing a string missing the left delimiter in array context, we found a ] or ,, stopping here",
        );
        break;
      }
    }

    if (
      !parser.streamStable &&
      parser.context.current === ContextValue.ObjectValue &&
      (char === "," || char === "}") &&
      (!stringAccumulator || stringAccumulator.at(-1) !== rightDelimiter)
    ) {
      let missingRightDelimiter = true;
      parser.skipWhitespaces();
      if (parser.getCharAt(1) === "\\") {
        missingRightDelimiter = false;
      }
      let offset = parser.skipToCharacter(rightDelimiter, 1);
      let nextChar = parser.getCharAt(offset);
      if (nextChar) {
        offset += 1;
        offset = parser.scrollWhitespaces(offset);
        nextChar = parser.getCharAt(offset);
        if (!nextChar || nextChar === "," || nextChar === "}") {
          missingRightDelimiter = false;
        } else {
          offset = parser.skipToCharacter(leftDelimiter, offset);
          nextChar = parser.getCharAt(offset);
          if (!nextChar) {
            missingRightDelimiter = false;
          } else {
            offset = parser.scrollWhitespaces(offset + 1);
            nextChar = parser.getCharAt(offset);
            if (nextChar && nextChar !== ":") {
              missingRightDelimiter = false;
            }
          }
        }
      } else {
        offset = parser.skipToCharacter(":", 1);
        nextChar = parser.getCharAt(offset);
        if (nextChar) {
          break;
        }
        offset = parser.scrollWhitespaces(1);
        const closingBraceOffset = parser.skipToCharacter("}", offset);
        if (closingBraceOffset - offset > 1) {
          missingRightDelimiter = false;
        } else if (parser.getCharAt(closingBraceOffset)) {
          for (const current of [...stringAccumulator].reverse()) {
            if (current === "{") {
              missingRightDelimiter = false;
              break;
            }
          }
        }
      }

      if (missingRightDelimiter) {
        parser.log(
          "While parsing a string missing the left delimiter in object value context, we found a , or } and we couldn't determine that a right delimiter was present. Stopping here",
        );
        break;
      }
    }

    if (
      !parser.streamStable &&
      char === "]" &&
      parser.context.context.includes(ContextValue.Array) &&
      (!stringAccumulator || stringAccumulator.at(-1) !== rightDelimiter)
    ) {
      const offset = parser.skipToCharacter(rightDelimiter);
      if (!parser.getCharAt(offset)) {
        break;
      }
    }

    if (parser.context.current === ContextValue.ObjectValue && char === "}") {
      const offset = parser.scrollWhitespaces(1);
      const nextChar = parser.getCharAt(offset);
      if (
        nextChar === "`" &&
        parser.getCharAt(offset + 1) === "`" &&
        parser.getCharAt(offset + 2) === "`"
      ) {
        parser.log(
          "While parsing a string in object value context, we found a } that closes the object before code fences, stopping here",
        );
        break;
      }
      if (!nextChar) {
        parser.log("While parsing a string in object value context, we found a } that closes the object, stopping here");
        break;
      }
    }

    stringAccumulator += char;
    parser.index += 1;
    char = parser.getCharAt();

    if (!char) {
      if (parser.streamStable && stringAccumulator.endsWith("\\")) {
        stringAccumulator = stringAccumulator.slice(0, -1);
      }
      break;
    }

    if (stringAccumulator.endsWith("\\")) {
      parser.log("Found a stray escape sequence, normalizing it");
      if ([rightDelimiter, "t", "n", "r", "b", "\\"].includes(char)) {
        stringAccumulator = stringAccumulator.slice(0, -1);
        const escapes: Record<string, string> = {
          b: "\b",
          n: "\n",
          r: "\r",
          t: "\t",
        };
        stringAccumulator += escapes[char] ?? char;
        parser.index += 1;
        char = parser.getCharAt();
        while (
          char &&
          stringAccumulator.endsWith("\\") &&
          (char === rightDelimiter || char === "\\")
        ) {
          stringAccumulator = `${stringAccumulator.slice(0, -1)}${char}`;
          parser.index += 1;
          char = parser.getCharAt();
        }
        continue;
      }

      if (char === "u" || char === "x") {
        const numChars = char === "u" ? 4 : 2;
        const nextChars = parser.sliceSource(parser.index + 1, parser.index + 1 + numChars);
        if (nextChars.length === numChars && /^[0-9A-Fa-f]+$/u.test(nextChars)) {
          parser.log("Found a unicode escape sequence, normalizing it");
          stringAccumulator = `${stringAccumulator.slice(0, -1)}${String.fromCodePoint(parseInt(nextChars, 16))}`;
          parser.index += 1 + numChars;
          char = parser.getCharAt();
          continue;
        }
      } else if (STRING_DELIMITERS.includes(char as (typeof STRING_DELIMITERS)[number]) && char !== rightDelimiter) {
        parser.log("Found a delimiter that was escaped but shouldn't be escaped, removing the escape");
        stringAccumulator = `${stringAccumulator.slice(0, -1)}${char}`;
        parser.index += 1;
        char = parser.getCharAt();
        continue;
      }
    }

    if (char === ":" && !missingQuotes && parser.context.current === ContextValue.ObjectKey) {
      let offset = parser.skipToCharacter(leftDelimiter, 1);
      let nextChar = parser.getCharAt(offset);
      if (nextChar) {
        offset += 1;
        offset = parser.skipToCharacter(rightDelimiter, offset);
        nextChar = parser.getCharAt(offset);
        if (nextChar) {
          offset += 1;
          offset = parser.scrollWhitespaces(offset);
          const current = parser.getCharAt(offset);
          if (current === "," || current === "}") {
            parser.log(
              `While parsing a string missing the right delimiter in object key context, we found a ${current} stopping here`,
            );
            break;
          }
        }
      } else {
        parser.log(
          "While parsing a string missing the right delimiter in object key context, we found a :, stopping here",
        );
        break;
      }
    }

    if (char === rightDelimiter && !stringAccumulator.endsWith("\\")) {
      const nextNonWhitespace = parser.getCharAt(parser.scrollWhitespaces(1));
      if (
        rightDelimiter === "'" &&
        ((parser.context.current === ContextValue.ObjectKey && nextNonWhitespace === ":") ||
          (parser.context.current === ContextValue.ObjectValue &&
            (nextNonWhitespace === "," || nextNonWhitespace === "}")) ||
          (parser.context.current === ContextValue.Array &&
            (nextNonWhitespace === "," || nextNonWhitespace === "]")))
      ) {
        break;
      }

      if (doubledQuotes && parser.getCharAt(1) === rightDelimiter) {
        parser.log("While parsing a string, we found a doubled quote, ignoring it");
        parser.index += 1;
      } else if (missingQuotes && parser.context.current === ContextValue.ObjectValue) {
        let offset = 1;
        let nextChar = parser.getCharAt(offset);
        while (nextChar && nextChar !== rightDelimiter && nextChar !== leftDelimiter) {
          offset += 1;
          nextChar = parser.getCharAt(offset);
        }
        if (nextChar) {
          offset += 1;
          offset = parser.scrollWhitespaces(offset);
          if (parser.getCharAt(offset) === ":") {
            parser.index -= 1;
            char = parser.getCharAt();
            parser.log(
              "In a string with missing quotes and object value context, I found a delimeter but it turns out it was the beginning on the next key. Stopping here.",
            );
            break;
          }
        }
      } else if (unmatchedDelimiter) {
        unmatchedDelimiter = false;
        [stringAccumulator, char] = appendLiteralChar(stringAccumulator, char);
      } else {
        let offset = 1;
        let nextChar = parser.getCharAt(offset);
        let checkCommaInObjectValue = true;
        while (nextChar && nextChar !== rightDelimiter && nextChar !== leftDelimiter) {
          if (checkCommaInObjectValue && /[A-Za-z]/u.test(nextChar)) {
            checkCommaInObjectValue = false;
          }
          if (
            (parser.context.context.includes(ContextValue.ObjectKey) && (nextChar === ":" || nextChar === "}")) ||
            (parser.context.context.includes(ContextValue.ObjectValue) && nextChar === "}") ||
            (parser.context.context.includes(ContextValue.Array) && (nextChar === "]" || nextChar === ",")) ||
            (checkCommaInObjectValue &&
              parser.context.current === ContextValue.ObjectValue &&
              nextChar === ",")
          ) {
            break;
          }
          offset += 1;
          nextChar = parser.getCharAt(offset);
        }

        if (nextChar === "," && parser.context.current === ContextValue.ObjectValue) {
          offset += 1;
          offset = parser.skipToCharacter(rightDelimiter, offset);
          nextChar = parser.getCharAt(offset);
          offset += 1;
          offset = parser.scrollWhitespaces(offset);
          nextChar = parser.getCharAt(offset);
          if (nextChar === "}" || nextChar === ",") {
            parser.log(
              "While parsing a string, we found a misplaced quote that would have closed the string but has a different meaning here, ignoring it",
            );
            [stringAccumulator, char] = appendLiteralChar(stringAccumulator, char);
            continue;
          }
        } else if (nextChar === rightDelimiter && parser.getCharAt(offset - 1) !== "\\") {
          if (onlyWhitespaceUntil(parser, offset)) {
            break;
          }

          if (parser.context.current === ContextValue.ObjectValue) {
            offset = parser.scrollWhitespaces(offset + 1);
            if (parser.getCharAt(offset) === ",") {
              offset = parser.skipToCharacter(leftDelimiter, offset + 1);
              offset += 1;
              offset = parser.skipToCharacter(rightDelimiter, offset + 1);
              offset += 1;
              offset = parser.scrollWhitespaces(offset);
              nextChar = parser.getCharAt(offset);
              if (nextChar === ":") {
                parser.log(
                  "While parsing a string, we found a misplaced quote that would have closed the string but has a different meaning here, ignoring it",
                );
                [stringAccumulator, char] = appendLiteralChar(stringAccumulator, char);
                continue;
              }
            }

            offset = parser.skipToCharacter(rightDelimiter, offset + 1);
            offset += 1;
            nextChar = parser.getCharAt(offset);
            while (nextChar && nextChar !== ":") {
              if (nextChar === "," || nextChar === "]" || nextChar === "}" || (nextChar === rightDelimiter && parser.getCharAt(offset - 1) !== "\\")) {
                break;
              }
              offset += 1;
              nextChar = parser.getCharAt(offset);
            }
            if (nextChar !== ":") {
              parser.log(
                "While parsing a string, we found a misplaced quote that would have closed the string but has a different meaning here, ignoring it",
              );
              unmatchedDelimiter = !unmatchedDelimiter;
              [stringAccumulator, char] = appendLiteralChar(stringAccumulator, char);
            }
          } else if (parser.context.current === ContextValue.Array) {
            let evenDelimiters = nextChar === rightDelimiter;
            while (nextChar === rightDelimiter) {
              offset = parser.skipToCharacter([rightDelimiter, "]"], offset + 1);
              nextChar = parser.getCharAt(offset);
              if (nextChar !== rightDelimiter) {
                evenDelimiters = false;
                break;
              }
              offset = parser.skipToCharacter([rightDelimiter, "]"], offset + 1);
              nextChar = parser.getCharAt(offset);
            }
            if (evenDelimiters) {
              parser.log(
                "While parsing a string in Array context, we detected a quoted section that would have closed the string but has a different meaning here, ignoring it",
              );
              unmatchedDelimiter = !unmatchedDelimiter;
              [stringAccumulator, char] = appendLiteralChar(stringAccumulator, char);
            } else {
              break;
            }
          } else if (parser.context.current === ContextValue.ObjectKey) {
            parser.log(
              "While parsing a string in Object Key context, we detected a quoted section that would have closed the string but has a different meaning here, ignoring it",
            );
            [stringAccumulator, char] = appendLiteralChar(stringAccumulator, char);
          }
        }
      }
    }
  }

  if (char && missingQuotes && parser.context.current === ContextValue.ObjectKey && /\s/u.test(char)) {
    parser.log(
      "While parsing a string, handling an extreme corner case in which the LLM added a comment instead of valid string, invalidate the string and return an empty value",
    );
    parser.skipWhitespaces();
    if (parser.getCharAt() !== ":" && parser.getCharAt() !== ",") {
      return "";
    }
  }

  if (char !== rightDelimiter) {
    if (!parser.streamStable) {
      parser.log("While parsing a string, we missed the closing quote, ignoring");
      stringAccumulator = stringAccumulator.replace(/\s+$/u, "");
    }
  } else {
    parser.index += 1;
  }

  if (!parser.streamStable && (missingQuotes || stringAccumulator.endsWith("\n"))) {
    stringAccumulator = stringAccumulator.replace(/\s+$/u, "");
  }

  return stringAccumulator;
}
