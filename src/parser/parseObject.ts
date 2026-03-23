import type { JsonNode, JsonSchema } from "../types";
import type { JsonRepairParser } from "./JsonRepairParser";
import { STRING_DELIMITERS } from "./constants";
import { ContextValue } from "./context";
import { MISSING_VALUE } from "./constants";
import { matchPatternProperties } from "../utils/patternProperties";

export function parseObject(parser: JsonRepairParser, schema?: JsonSchema, path = "$"): JsonNode {
  const objectValue: Record<string, JsonNode> = {};
  const startIndex = parser.index;
  const parsingObjectValue = parser.context.current === ContextValue.ObjectValue;
  let properties: Record<string, JsonSchema> = {};
  let patternProperties: Record<string, JsonSchema> = {};
  let additionalProperties: unknown;
  let required = new Set<string>();
  let schemaRepairer = null;

  if (schema !== undefined && schema !== true && parser.schemaRepairer) {
    const resolved = parser.schemaRepairer.resolveSchema(schema);
    if (resolved === false) {
      throw new Error("Schema does not allow any values.");
    }
    if (resolved !== true && parser.schemaRepairer.isObjectSchema(resolved)) {
      schemaRepairer = parser.schemaRepairer;
      properties =
        resolved.properties && typeof resolved.properties === "object" && !Array.isArray(resolved.properties)
          ? (resolved.properties as Record<string, JsonSchema>)
          : {};
      patternProperties =
        resolved.patternProperties && typeof resolved.patternProperties === "object" && !Array.isArray(resolved.patternProperties)
          ? (resolved.patternProperties as Record<string, JsonSchema>)
          : {};
      additionalProperties = resolved.additionalProperties;
      required = new Set(Array.isArray(resolved.required) ? (resolved.required as string[]) : []);
    }
  }

  const finalizeObject = (): Record<string, JsonNode> => {
    if (!schemaRepairer) {
      return objectValue;
    }
    const missingRequired = [...required].filter((key) => !(key in objectValue));
    if (missingRequired.length > 0 && schemaRepairer.schemaRepairMode !== "salvage") {
      throw new Error(`Missing required properties at ${path}: ${missingRequired.join(", ")}`);
    }
    for (const [key, propSchema] of Object.entries(properties)) {
      if (key in objectValue || required.has(key)) {
        continue;
      }
      if (propSchema && typeof propSchema === "object" && !Array.isArray(propSchema) && "default" in propSchema) {
        objectValue[key] = schemaRepairer.copyJsonValue(
          (propSchema as Record<string, unknown>).default,
          `${path}.${key}`,
          "default",
        ) as JsonNode;
        schemaRepairer.log("Inserted default value for missing property", `${path}.${key}`);
      }
    }
    return objectValue;
  };

  while ((parser.getCharAt() ?? "}") !== "}") {
    parser.skipWhitespaces();

    if (parser.getCharAt() === ":") {
      parser.log("While parsing an object we found a : before a key, ignoring");
      parser.index += 1;
    }

    parser.context.set(ContextValue.ObjectKey);
    let rollbackIndex = parser.index;
    let key = "";

    while (parser.getCharAt()) {
      rollbackIndex = parser.index;
      if (parser.getCharAt() === "[" && key === "") {
        const previousKey = Object.keys(objectValue).at(-1);
        if (previousKey && Array.isArray(objectValue[previousKey]) && !parser.strict) {
          parser.index += 1;
          const newArray = parser.parseArray();
          const previousValue = objectValue[previousKey];
          if (Array.isArray(previousValue)) {
            const listLengths = previousValue
              .filter((item): item is JsonNode[] => Array.isArray(item))
              .map((item) => item.length);
            const expectedLength =
              listLengths.length > 0 && listLengths.every((length) => length === listLengths[0])
                ? listLengths[0]
                : undefined;

            if (expectedLength) {
              const tail: JsonNode[] = [];
              while (previousValue.length > 0 && !Array.isArray(previousValue.at(-1))) {
                tail.push(previousValue.pop() as JsonNode);
              }
              if (tail.length > 0) {
                tail.reverse();
                if (tail.length % expectedLength === 0) {
                  parser.log(
                    "While parsing an object we found row values without an inner array, grouping them into rows",
                  );
                  for (let index = 0; index < tail.length; index += expectedLength) {
                    previousValue.push(tail.slice(index, index + expectedLength));
                  }
                } else {
                  previousValue.push(...tail);
                }
              }

              if (newArray.length > 0) {
                if (newArray.every((item) => Array.isArray(item))) {
                  parser.log(
                    "While parsing an object we found additional rows, appending them without flattening",
                  );
                  previousValue.push(...newArray);
                } else {
                  previousValue.push(newArray);
                }
              }
            } else {
              previousValue.push(...(newArray.length === 1 && Array.isArray(newArray[0]) ? newArray[0] : newArray));
            }
          }

          parser.skipWhitespaces();
          if (parser.getCharAt() === ",") {
            parser.index += 1;
          }
          parser.skipWhitespaces();
          continue;
        }
      }

      const rawKey = parser.parseString();
      key = typeof rawKey === "string" ? rawKey : String(rawKey);
      if (key === "") {
        parser.skipWhitespaces();
      }
      if (key !== "" || (key === "" && [":", "}"].includes(parser.getCharAt() ?? ""))) {
        if (key === "" && parser.strict) {
          parser.log("Empty key found in strict mode while parsing object, raising an error");
          throw new Error("Empty key found in strict mode while parsing object.");
        }
        break;
      }
    }

    if (parser.context.context.includes(ContextValue.Array) && key in objectValue) {
      if (parser.strict) {
        parser.log("Duplicate key found in strict mode while parsing object, raising an error");
        throw new Error("Duplicate key found in strict mode while parsing object.");
      }
      if (!parsingObjectValue) {
        let lookbackIndex = rollbackIndex - parser.index - 1;
        let previousNonWhitespace = parser.getCharAt(lookbackIndex);
        while (previousNonWhitespace && /\s/u.test(previousNonWhitespace)) {
          lookbackIndex -= 1;
          previousNonWhitespace = parser.getCharAt(lookbackIndex);
        }
        const keyStartChar = parser.getCharAt(rollbackIndex - parser.index);
        const nextNonWhitespace = parser.getCharAt(parser.scrollWhitespaces());
        const normalDuplicateMember =
          STRING_DELIMITERS.includes((keyStartChar ?? "") as (typeof STRING_DELIMITERS)[number]) &&
          previousNonWhitespace === "," &&
          nextNonWhitespace === ":";

        if (normalDuplicateMember) {
          parser.log(
            "While parsing an object we found a duplicate key with a normal comma separator, keeping duplicate-key overwrite behavior",
          );
        } else {
          parser.log(
            "While parsing an object we found a duplicate key, closing the object here and rolling back the index",
          );
          parser.index = rollbackIndex - 1;
          parser.insertIntoSource(parser.index + 1, "{");
          break;
        }
      }
    }

    parser.skipWhitespaces();
    if ((parser.getCharAt() ?? "}") === "}") {
      continue;
    }
    parser.skipWhitespaces();
    if (parser.getCharAt() !== ":") {
      if (parser.strict) {
        parser.log("Missing ':' after key in strict mode while parsing object, raising an error");
        throw new Error("Missing ':' after key in strict mode while parsing object.");
      }
      parser.log("While parsing an object we missed a : after a key");
    }

    parser.index += 1;
    parser.context.reset();
    parser.context.set(ContextValue.ObjectValue);
    parser.skipWhitespaces();

    let value: JsonNode = "";
    let propSchema: JsonSchema | undefined;
    const extraSchemas: JsonSchema[] = [];
    let dropProperty = false;
    if (schemaRepairer) {
      if (key in properties) {
        propSchema = properties[key];
      } else {
        const [matched, unsupported] = matchPatternProperties(patternProperties, key);
        for (const pattern of unsupported) {
          parser.log(`Skipped unsupported patternProperties regex '${pattern}' while parsing object key '${key}'`);
        }
        if (matched.length > 0) {
          propSchema = matched[0];
          extraSchemas.push(...matched.slice(1));
        } else if (additionalProperties === false) {
          dropProperty = true;
        } else if (additionalProperties && typeof additionalProperties === "object" && !Array.isArray(additionalProperties)) {
          propSchema = additionalProperties as JsonSchema;
        } else {
          propSchema = true;
        }
      }
    }

    const char = parser.getCharAt();
    if (char === "," || char === "}") {
      parser.log(`While parsing an object value we found a stray ${char}, ignoring it`);
      if (schemaRepairer && propSchema !== undefined) {
        value = schemaRepairer.repairValue(MISSING_VALUE, propSchema, `${path}.${key}`) as JsonNode;
      }
    } else {
      value = schemaRepairer ? parser.parseJson(propSchema, `${path}.${key}`) : parser.parseJson();
    }

    if (schemaRepairer) {
      for (const extraSchema of extraSchemas) {
        value = schemaRepairer.repairValue(value, extraSchema, `${path}.${key}`) as JsonNode;
      }
    }

    if (value === "" && parser.strict && !STRING_DELIMITERS.includes((parser.getCharAt(-1) ?? "") as never)) {
      parser.log("Parsed value is empty in strict mode while parsing object, raising an error");
      throw new Error("Parsed value is empty in strict mode while parsing object.");
    }

    parser.context.reset();
    if (!schemaRepairer || !dropProperty) {
      objectValue[key] = value;
    } else {
      schemaRepairer.log("Dropped extra property not covered by schema", `${path}.${key}`);
    }

    if ([",", "'", '"'].includes(parser.getCharAt() ?? "")) {
      parser.index += 1;
    }
    if (parser.getCharAt() === "]" && parser.context.context.includes(ContextValue.Array)) {
      parser.log(
        "While parsing an object we found a closing array bracket, closing the object here and rolling back the index",
      );
      parser.index -= 1;
      break;
    }
    parser.skipWhitespaces();
  }

  parser.index += 1;

  if (Object.keys(objectValue).length === 0 && parser.index - startIndex > 2) {
    if (parser.strict) {
      parser.log("Parsed object is empty but contains extra characters in strict mode, raising an error");
      throw new Error("Parsed object is empty but contains extra characters in strict mode.");
    }
    parser.log("Parsed object is empty, we will try to parse this as an array instead");
    parser.index = startIndex;
    return parser.parseArray();
  }

  if (!parser.context.empty) {
    if (
      parser.getCharAt() === "}" &&
      parser.context.current !== ContextValue.ObjectKey &&
      parser.context.current !== ContextValue.ObjectValue
    ) {
      parser.log("Found an extra closing brace that shouldn't be there, skipping it");
      parser.index += 1;
    }
    return objectValue;
  }

  parser.skipWhitespaces();
  if (parser.getCharAt() !== ",") {
    return finalizeObject();
  }
  parser.index += 1;
  parser.skipWhitespaces();
  if (!STRING_DELIMITERS.includes((parser.getCharAt() ?? "") as (typeof STRING_DELIMITERS)[number])) {
    return finalizeObject();
  }
  if (!parser.strict) {
    parser.log("Found a comma and string delimiter after object closing brace, checking for additional key-value pairs");
    const additionalObject = parser.parseObject(schema, path);
    if (additionalObject && typeof additionalObject === "object" && !Array.isArray(additionalObject)) {
      Object.assign(objectValue, additionalObject);
    }
  }

  return finalizeObject();
}
