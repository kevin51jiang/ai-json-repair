import type { JsonNode, JsonSchema } from "../types";
import type { JsonRepairParser } from "./JsonRepairParser";
import { STRING_DELIMITERS } from "./constants";
import { ContextValue } from "./context";
import { ObjectComparer } from "./objectComparer";

export function parseArray(parser: JsonRepairParser, schema?: JsonSchema, path = "$"): JsonNode[] {
  let itemsSchema: unknown;
  let additionalItems: unknown;
  let schemaRepairer = null;
  if (schema !== undefined && schema !== true && parser.schemaRepairer) {
    const resolved = parser.schemaRepairer.resolveSchema(schema);
    if (resolved === false) {
      throw new Error("Schema does not allow any values.");
    }
    if (resolved !== true && parser.schemaRepairer.isArraySchema(resolved)) {
      schemaRepairer = parser.schemaRepairer;
      itemsSchema = (resolved as Record<string, unknown>).items;
      additionalItems = (resolved as Record<string, unknown>).additionalItems;
    }
  }
  const salvageMode = schemaRepairer?.schemaRepairMode === "salvage";
  const result: JsonNode[] = [];
  parser.context.set(ContextValue.Array);
  parser.skipWhitespaces();

  let char = parser.getCharAt();
  let index = 0;
  while (char && char !== "]" && char !== "}") {
    let itemSchema: JsonSchema | undefined;
    let dropItem = false;
    if (schemaRepairer) {
      if (Array.isArray(itemsSchema)) {
        if (index < itemsSchema.length) {
          itemSchema = itemsSchema[index] as JsonSchema;
        } else if (additionalItems === false) {
          dropItem = true;
        } else if (additionalItems && typeof additionalItems === "object" && !Array.isArray(additionalItems)) {
          itemSchema = additionalItems as JsonSchema;
        } else {
          itemSchema = true;
        }
      } else if (itemsSchema && typeof itemsSchema === "object" && !Array.isArray(itemsSchema)) {
        itemSchema = itemsSchema as JsonSchema;
      } else {
        itemSchema = true;
      }
    }

    const itemPath = `${path}[${index}]`;
    const activeRepairer = schemaRepairer && !dropItem && !salvageMode ? schemaRepairer : null;
    let value: JsonNode;

    if (STRING_DELIMITERS.includes((char ?? "") as (typeof STRING_DELIMITERS)[number])) {
      let offset = 1;
      offset = parser.skipToCharacter(char, offset);
      offset = parser.scrollWhitespaces(offset + 1);
      if (parser.getCharAt(offset) === ":") {
        value = activeRepairer ? parser.parseObject(itemSchema, itemPath) : parser.parseObject();
        if (activeRepairer && itemSchema !== undefined) {
          value = activeRepairer.repairValue(value, itemSchema, itemPath);
        }
      } else {
        value = parser.parseString();
        if (activeRepairer && itemSchema !== undefined) {
          value = activeRepairer.repairValue(value, itemSchema, itemPath);
        }
      }
    } else {
      value = activeRepairer ? parser.parseJson(itemSchema, itemPath) : parser.parseJson();
    }

    if (ObjectComparer.isStrictlyEmpty(value) && parser.getCharAt() !== "]" && parser.getCharAt() !== ",") {
      parser.index += 1;
    } else if (value === "..." && parser.getCharAt(-1) === ".") {
      parser.log("While parsing an array, found a stray '...'; ignoring it");
    } else if (!dropItem) {
      result.push(value);
    } else if (schemaRepairer) {
      schemaRepairer.log("Dropped extra array item not covered by schema", itemPath);
    } else {
      result.push(value);
    }

    index += 1;
    char = parser.getCharAt();
    while (char && char !== "]" && (/\s/u.test(char) || char === ",")) {
      parser.index += 1;
      char = parser.getCharAt();
    }
  }

  if (char !== "]") {
    parser.log("While parsing an array we missed the closing ], ignoring it");
  }

  parser.index += 1;
  parser.context.reset();
  return result;
}
