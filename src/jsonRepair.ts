import { readFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";

import { JsonRepairParser } from "./parser/JsonRepairParser";
import { normalizeSchemaRepairMode, SchemaRepairer, schemaFromInput } from "./schema/schemaRepair";
import { stringifyJson, unwrapJsonValue } from "./stringify";
import type { JsonRepairOptions, JsonRepairResult, JsonSchema, JsonValue, RepairLog, SchemaRepairMode } from "./types";

function shouldSkipNativeParse(input: string): boolean {
  return /\d{16,}|\d[eE][+-]?\d/u.test(input);
}

function parseWithRepair(input: string, options: JsonRepairOptions) {
  const parser = new JsonRepairParser(
    input,
    options.logging ?? false,
    options.streamStable ?? false,
    options.strict ?? false,
  );
  const schemaRepairMode = normalizeSchemaRepairMode(options.schemaRepairMode);
  if (options.schema === undefined && schemaRepairMode === "salvage") {
    throw new Error("schema_repair_mode='salvage' requires schema.");
  }
  if (options.schema !== undefined && options.strict) {
    throw new Error("schema and strict cannot be used together.");
  }
  const schema = options.schema !== undefined ? schemaFromInput(options.schema) : undefined;
  const repairer = schema !== undefined ? new SchemaRepairer(schema, parser.logging ? parser.logger : null, schemaRepairMode) : null;
  const parsed = repairer && schema !== undefined ? parser.parseWithSchema(repairer, schema) : parser.parse();
  return {
    logs: parser.logger,
    parsed,
    repairer,
    schema,
  };
}

function tryNativeParse(input: string, options: JsonRepairOptions) {
  if (options.skipJsonParse || shouldSkipNativeParse(input)) {
    return undefined;
  }

  try {
    return JSON.parse(input) as JsonValue;
  } catch {
    return undefined;
  }
}

export function jsonRepair<T extends boolean | undefined = false>(
  input?: string,
  options?: JsonRepairOptions & { returnObjects?: T },
): JsonRepairResult<T>;
export function jsonRepair(
  input = "",
  options: JsonRepairOptions = {},
): JsonValue | [JsonValue, RepairLog[]] | [string, RepairLog[]] | string {
  const schemaRepairMode = normalizeSchemaRepairMode(options.schemaRepairMode);
  if (options.schema === undefined && schemaRepairMode === "salvage") {
    throw new Error("schema_repair_mode='salvage' requires schema.");
  }
  if (options.schema !== undefined && options.strict) {
    throw new Error("schema and strict cannot be used together.");
  }

  const schema = options.schema !== undefined ? schemaFromInput(options.schema) : undefined;
  const nativeParsed = tryNativeParse(input, options);
  if (nativeParsed !== undefined) {
    let validFastPath = true;
    let fastPathValue: JsonValue = nativeParsed;
    if (schema !== undefined) {
      const repairer = new SchemaRepairer(schema, options.logging ? [] : null, schemaRepairMode);
      if (repairer.isValid(nativeParsed, schema)) {
        validFastPath = true;
      } else {
        try {
          const repairedValue = repairer.repairValue(nativeParsed, schema, "$");
          repairer.validate(repairedValue, schema);
          fastPathValue = repairedValue;
        } catch {
          validFastPath = false;
        }
      }
    }
    if (!validFastPath) {
      // fall through to parser path
    } else {
      if (options.logging) {
        return [
          options.returnObjects
            ? fastPathValue
            : stringifyJson(fastPathValue as never, options.indent ?? options.space, options.ensureAscii ?? true),
          [],
        ];
      }
      if (options.returnObjects) {
        return fastPathValue;
      }
      return stringifyJson(fastPathValue as never, options.indent ?? options.space, options.ensureAscii ?? true);
    }
  }

  const { logs, parsed, repairer } = parseWithRepair(input, { ...options, schema, schemaRepairMode });
  if (repairer && schema !== undefined) {
    repairer.validate(unwrapJsonValue(parsed), schema);
  }
  const unwrapped = unwrapJsonValue(parsed);

  if (options.logging) {
    if (options.returnObjects) {
      return [unwrapped, logs];
    }
    if (unwrapped === "") {
      return ["", logs];
    }
    return [stringifyJson(parsed, options.indent ?? options.space, options.ensureAscii ?? true), logs];
  }

  if (options.returnObjects) {
    return unwrapped;
  }

  if (unwrapped === "") {
    return "";
  }

  return stringifyJson(parsed, options.indent ?? options.space, options.ensureAscii ?? true);
}

export function jsonParse(input: string, options: Omit<JsonRepairOptions, "returnObjects"> = {}): JsonValue {
  return jsonRepair(input, { ...options, returnObjects: true }) as JsonValue;
}

export function loads(input: string, options: Omit<JsonRepairOptions, "returnObjects"> = {}): JsonValue {
  return jsonParse(input, options);
}

export async function load(
  fd: FileHandle | { readFile: (options?: { encoding: BufferEncoding }) => Promise<string> } | { toString(): string },
  options: Omit<JsonRepairOptions, "returnObjects"> = {},
): Promise<JsonValue | [JsonValue, RepairLog[]]> {
  let contents = "";
  if (fd && typeof fd === "object" && "readFile" in fd && typeof fd.readFile === "function") {
    contents = await fd.readFile({ encoding: "utf8" });
  } else {
    contents = String(fd);
  }
  return jsonRepair(contents, { ...options, returnObjects: true }) as JsonValue | [JsonValue, RepairLog[]];
}

export async function fromFile(
  filename: string | URL,
  options: Omit<JsonRepairOptions, "returnObjects"> = {},
): Promise<JsonValue | [JsonValue, RepairLog[]]> {
  const contents = await readFile(filename, "utf8");
  return jsonRepair(contents, { ...options, returnObjects: true }) as JsonValue | [JsonValue, RepairLog[]];
}

export const repairJson = Object.assign(jsonRepair, { parse: jsonParse });
