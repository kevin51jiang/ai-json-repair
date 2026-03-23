export interface RepairLog {
  context: string;
  text: string;
}

export interface JsonNumberToken {
  raw: string;
  value: bigint | number;
}

export interface JsonObjectNode {
  [key: string]: JsonNode;
}

export interface JsonArrayNode extends Array<JsonNode> {}

export type JsonNode = JsonArrayNode | JsonNumberToken | JsonObjectNode | bigint | boolean | null | number | string;

export type JsonPrimitive = bigint | boolean | null | number | string;
export interface JsonObjectValue {
  [key: string]: JsonValue;
}

export interface JsonArrayValue extends Array<JsonValue> {}

export type JsonValue = JsonArrayValue | JsonObjectValue | JsonPrimitive;

export interface JsonRepairOptions {
  chunkLength?: number;
  ensureAscii?: boolean;
  indent?: number | string;
  logging?: boolean;
  returnObjects?: boolean;
  schema?: JsonSchema;
  schemaRepairMode?: SchemaRepairMode;
  skipJsonParse?: boolean;
  space?: number | string;
  streamStable?: boolean;
  strict?: boolean;
}

export type JsonSchema = boolean | JsonSchemaObject;

export interface JsonSchemaObject {
  [key: string]: unknown;
}

export type SchemaRepairMode = "salvage" | "standard";

export type JsonRepairResult<T extends boolean | undefined> = T extends true ? JsonValue : string;
