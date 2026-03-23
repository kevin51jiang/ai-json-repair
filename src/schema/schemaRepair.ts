import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";

import type { JsonNode, JsonSchema, JsonSchemaObject, JsonValue, RepairLog, SchemaRepairMode } from "../types";
import { MISSING_VALUE, type MissingValueType } from "../parser/constants";
import { matchPatternProperties } from "../utils/patternProperties";

type JSONCompatible = JsonValue;

function isNumberToken(value: unknown): value is { raw: string; value: bigint | number } {
  return value !== null && typeof value === "object" && "raw" in value && "value" in value;
}

function unwrapNodeValue<T>(value: T): T | bigint | number {
  if (isNumberToken(value)) {
    return value.value;
  }
  return value;
}

export class SchemaDefinitionError extends Error {}

export function normalizeSchemaRepairMode(mode?: string): SchemaRepairMode {
  if (mode === undefined) {
    return "standard";
  }
  if (mode === "standard" || mode === "salvage") {
    return mode;
  }
  throw new Error("schema_repair_mode must be one of: standard, salvage.");
}

export function normalizeMissingValues(value: unknown): JSONCompatible {
  if (isNumberToken(value)) {
    return value.value;
  }
  if (value === MISSING_VALUE) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeMissingValues(item));
  }
  if (value && typeof value === "object") {
    const normalized: Record<string, JSONCompatible> = {};
    for (const [key, item] of Object.entries(value)) {
      if (typeof key !== "string") {
        throw new Error("Object keys must be strings.");
      }
      normalized[key] = normalizeMissingValues(item);
    }
    return normalized;
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value as JSONCompatible;
  }
  throw new Error("Value is not JSON compatible.");
}

export function schemaFromInput(schema: unknown): JsonSchema {
  if (schema === true || schema === false) {
    return schema;
  }
  if (typeof schema === "function" && "toJSONSchema" in schema && typeof schema.toJSONSchema === "function") {
    return schemaFromInput(schema.toJSONSchema());
  }
  if (
    schema &&
    typeof schema === "object" &&
    "toJSONSchema" in schema &&
    typeof (schema as { toJSONSchema?: () => unknown }).toJSONSchema === "function"
  ) {
    return schemaFromInput((schema as { toJSONSchema: () => unknown }).toJSONSchema());
  }
  if (schema && typeof schema === "object" && !Array.isArray(schema)) {
    return schema as JsonSchemaObject;
  }
  throw new Error("Schema must be a JSON Schema dict, boolean schema, or compatible schema object.");
}

export async function loadSchemaModule(path: string): Promise<JsonSchema> {
  if (!path.includes(":")) {
    throw new Error("Schema module must be in the form 'modulePath:exportName'.");
  }
  const [modulePath, exportName] = path.split(":", 2);
  const imported = (await import(modulePath)) as Record<string, unknown>;
  if (!(exportName in imported)) {
    throw new Error(`Schema export '${exportName}' not found in module '${modulePath}'.`);
  }
  return schemaFromInput(imported[exportName]);
}

function prepareSchemaForValidationNode(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => prepareSchemaForValidationNode(item));
  }
  if (node && typeof node === "object") {
    const normalized = Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, prepareSchemaForValidationNode(value)]),
    ) as Record<string, unknown>;
    const items = normalized.items;
    if (Array.isArray(items)) {
      delete normalized.items;
      normalized.prefixItems = items;
      const additionalItems = normalized.additionalItems;
      delete normalized.additionalItems;
      if (additionalItems === false) {
        normalized.items = false;
      } else if (additionalItems && typeof additionalItems === "object") {
        normalized.items = additionalItems;
      }
    }
    return normalized;
  }
  return node;
}

export class SchemaRepairer {
  private readonly ajv = new Ajv2020({ allErrors: false, strict: false, validateSchema: false });
  private readonly validatorCache = new WeakMap<JsonSchemaObject, ValidateFunction>();

  public constructor(
    public readonly rootSchema: JsonSchema,
    private readonly logEntries: RepairLog[] | null,
    public readonly schemaRepairMode: SchemaRepairMode = "standard",
  ) {}

  public log(text: string, path: string): void {
    if (this.logEntries) {
      this.logEntries.push({ context: path, text });
    }
  }

  public getValidator(schema: JsonSchemaObject): ValidateFunction {
    const cached = this.validatorCache.get(schema);
    if (cached) {
      return cached;
    }
    const prepared = this.prepareSchemaForValidation(schema);
    const validator = this.ajv.compile(prepared);
    this.validatorCache.set(schema, validator);
    return validator;
  }

  public isValid(value: JsonValue, schema: JsonSchema): boolean {
    const resolved = this.resolveSchema(schema);
    if (resolved === true) {
      return true;
    }
    if (resolved === false) {
      return false;
    }
    return Boolean(this.getValidator(resolved)(value));
  }

  public validate(value: JsonValue, schema: JsonSchema): void {
    const resolved = this.resolveSchema(schema);
    if (resolved === true) {
      return;
    }
    if (resolved === false) {
      throw new Error("Schema does not allow any values.");
    }
    const validator = this.getValidator(resolved);
    if (!validator(value)) {
      const message = validator.errors?.[0]?.message ?? "Schema validation failed.";
      throw new Error(message);
    }
  }

  public resolveSchema(schema: unknown): JsonSchema {
    if (schema === undefined || schema === null) {
      return true;
    }
    if (schema === true || schema === false) {
      return schema;
    }
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
      throw new SchemaDefinitionError("Schema must be an object.");
    }
    const schemaObject = { ...(schema as Record<string, unknown>) };
    for (const key of Object.keys(schemaObject)) {
      if (typeof key !== "string") {
        throw new SchemaDefinitionError("Schema keys must be strings.");
      }
    }
    let current: JsonSchema = schemaObject;
    while (current && typeof current === "object" && !Array.isArray(current) && "$ref" in current) {
      current = this.resolveRef((current as Record<string, unknown>).$ref as string);
    }
    return current;
  }

  public isObjectSchema(schema: JsonSchema | undefined): boolean {
    const resolved = this.resolveSchema(schema);
    if (resolved === true || resolved === false || Array.isArray(resolved)) {
      return false;
    }
    const schemaType = resolved.type;
    if (schemaType === "object") {
      return true;
    }
    if (Array.isArray(schemaType) && schemaType.includes("object")) {
      return true;
    }
    return ["additionalProperties", "patternProperties", "properties", "required"].some((key) => key in resolved);
  }

  public isArraySchema(schema: JsonSchema | undefined): boolean {
    const resolved = this.resolveSchema(schema);
    if (resolved === true || resolved === false || Array.isArray(resolved)) {
      return false;
    }
    const schemaType = resolved.type;
    if (schemaType === "array") {
      return true;
    }
    if (Array.isArray(schemaType) && schemaType.includes("array")) {
      return true;
    }
    return "items" in resolved;
  }

  public canSalvageListAsObject(schema: JsonSchemaObject): boolean {
    return this.allowsSchemaType(schema, "object") && !this.allowsSchemaType(schema, "array");
  }

  public repairValue(value: unknown, schema: JsonSchema | undefined, path: string): JsonValue {
    value = unwrapNodeValue(value);
    const resolved = this.resolveSchema(schema);
    if (resolved === true) {
      return normalizeMissingValues(value);
    }
    if (resolved === false) {
      throw new Error("Schema does not allow any values.");
    }
    if (Object.keys(resolved).length === 0) {
      return normalizeMissingValues(value);
    }

    if (value === MISSING_VALUE) {
      return this.fillMissing(resolved, path);
    }

    if (Array.isArray(resolved.allOf)) {
      if (resolved.allOf.length === 0) {
        return normalizeMissingValues(value);
      }
      let repaired = this.repairValue(value, resolved.allOf[0] as JsonSchema, path);
      for (const subschema of resolved.allOf.slice(1)) {
        repaired = this.repairValue(repaired, subschema as JsonSchema, path);
      }
      return repaired;
    }
    if (Array.isArray(resolved.oneOf)) {
      return this.repairUnion(value, resolved.oneOf as JsonSchema[], path);
    }
    if (Array.isArray(resolved.anyOf)) {
      return this.repairUnion(value, resolved.anyOf as JsonSchema[], path);
    }

    let expectedType = resolved.type;
    if (expectedType === undefined) {
      if (this.isObjectSchema(resolved)) {
        expectedType = "object";
      } else if (this.isArraySchema(resolved)) {
        expectedType = "array";
      }
    }

    if (Array.isArray(expectedType)) {
      return this.repairTypeUnion(value, expectedType as string[], resolved, path);
    }

    let repaired: JsonValue;
    if (expectedType === "object") {
      repaired = this.repairObject(value, resolved, path);
    } else if (expectedType === "array") {
      repaired = this.repairArray(value, resolved, path);
    } else if (typeof expectedType === "string") {
      repaired = this.coerceScalar(value, expectedType, path);
    } else {
      repaired = normalizeMissingValues(value);
    }

    return this.applyEnumConst(repaired, resolved, path);
  }

  public repairArray(value: unknown, schema: JsonSchemaObject, path: string): JsonValue {
    let items = Array.isArray(value) ? [...value] : [normalizeMissingValues(value)];
    if (!Array.isArray(value)) {
      this.log("Wrapped value in array to match schema", path);
    }
    const salvageMode = this.schemaRepairMode === "salvage";

    const repairOrDrop = (rawItem: unknown, itemSchema: JsonSchema, itemPath: string): [boolean, JsonValue | null] => {
      try {
        return [true, this.repairValue(rawItem, itemSchema, itemPath)];
      } catch (error) {
        if (error instanceof SchemaDefinitionError || !salvageMode) {
          throw error;
        }
        this.log("Dropped invalid array item while salvaging", itemPath);
        return [false, null];
      }
    };

    const itemsSchema = schema.items;
    if (itemsSchema !== undefined) {
      if (Array.isArray(itemsSchema)) {
        const repaired: JsonValue[] = [];
        for (let index = 0; index < itemsSchema.length && index < items.length; index += 1) {
          const [keep, repairedValue] = repairOrDrop(items[index], itemsSchema[index] as JsonSchema, `${path}[${index}]`);
          if (keep) {
            repaired.push(repairedValue as JsonValue);
          }
        }
        const additionalItems = schema.additionalItems;
        if (items.length > itemsSchema.length) {
          const tail = items.slice(itemsSchema.length);
          if (additionalItems && typeof additionalItems === "object" && !Array.isArray(additionalItems)) {
            for (let offset = 0; offset < tail.length; offset += 1) {
              const [keep, repairedValue] = repairOrDrop(
                tail[offset],
                additionalItems as JsonSchema,
                `${path}[${itemsSchema.length + offset}]`,
              );
              if (keep) {
                repaired.push(repairedValue as JsonValue);
              }
            }
          } else if (additionalItems === true || additionalItems === undefined) {
            repaired.push(...tail.map((item) => normalizeMissingValues(item)));
          } else {
            for (let offset = 0; offset < tail.length; offset += 1) {
              this.log("Dropped extra array item not covered by schema", `${path}[${itemsSchema.length + offset}]`);
            }
          }
        }
        items = repaired;
      } else {
        const repaired: JsonValue[] = [];
        for (let index = 0; index < items.length; index += 1) {
          const [keep, repairedValue] = repairOrDrop(items[index], itemsSchema as JsonSchema, `${path}[${index}]`);
          if (keep) {
            repaired.push(repairedValue as JsonValue);
          }
        }
        items = repaired;
      }
    }
    if (typeof schema.minItems === "number" && items.length < schema.minItems) {
      throw new Error(`Array at ${path} does not meet minItems.`);
    }
    return items as JsonValue;
  }

  public repairObject(value: unknown, schema: JsonSchemaObject, path: string): JsonValue {
    if (this.schemaRepairMode === "salvage" && Array.isArray(value) && this.canSalvageListAsObject(schema)) {
      const mapped = this.mapListToObject(value, schema, path);
      if (mapped) {
        value = mapped;
      } else if (path === "$" && value.length === 1 && value[0] && typeof value[0] === "object" && !Array.isArray(value[0])) {
        value = value[0];
        this.log("Unwrapped single-item root array to object while salvaging", path);
      }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Expected object at ${path}, got ${Array.isArray(value) ? "list" : typeof value}.`);
    }

    const properties =
      schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
        ? (schema.properties as Record<string, JsonSchema>)
        : {};
    const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
    const patternProperties =
      schema.patternProperties && typeof schema.patternProperties === "object" && !Array.isArray(schema.patternProperties)
        ? (schema.patternProperties as Record<string, JsonSchema>)
        : {};
    const additionalProperties = schema.additionalProperties;

    let objectValue = { ...(value as Record<string, unknown>) };
    if (this.schemaRepairMode === "salvage" && required.size > 0) {
      for (const key of required) {
        if (key in objectValue) {
          continue;
        }
        const propSchema = properties[key];
        if (propSchema === undefined) {
          continue;
        }
        const [filled, filledValue] = this.fillMissingRequiredForSalvage(propSchema, `${path}.${key}`);
        if (filled) {
          objectValue[key] = filledValue;
          this.log("Filled missing required property while salvaging", `${path}.${key}`);
        }
      }
    }

    const missingRequired = [...required].filter((key) => !(key in objectValue));
    if (missingRequired.length > 0) {
      throw new Error(`Missing required properties at ${path}: ${missingRequired.join(", ")}`);
    }

    const repaired: Record<string, JsonValue> = {};
    for (const [key, propSchema] of Object.entries(properties)) {
      const keyPath = `${path}.${key}`;
      if (key in objectValue) {
        repaired[key] = this.repairValue(objectValue[key], propSchema, keyPath);
      } else if (propSchema && typeof propSchema === "object" && !Array.isArray(propSchema) && "default" in propSchema && !required.has(key)) {
        repaired[key] = this.copyJsonValue((propSchema as Record<string, unknown>).default, keyPath, "default");
        this.log("Inserted default value for missing property", keyPath);
      }
    }

    for (const [key, rawValue] of Object.entries(objectValue)) {
      if (key in properties) {
        continue;
      }
      const keyPath = `${path}.${key}`;
      const [matched, unsupported] = matchPatternProperties(patternProperties, key);
      for (const pattern of unsupported) {
        this.log(`Skipped unsupported patternProperties regex '${pattern}'`, keyPath);
      }
      if (matched.length > 0) {
        let repairedValue = this.repairValue(rawValue, matched[0], keyPath);
        for (const propSchema of matched.slice(1)) {
          repairedValue = this.repairValue(repairedValue, propSchema, keyPath);
        }
        repaired[key] = repairedValue;
        continue;
      }
      if (additionalProperties && typeof additionalProperties === "object" && !Array.isArray(additionalProperties)) {
        repaired[key] = this.repairValue(rawValue, additionalProperties as JsonSchema, keyPath);
        continue;
      }
      if (additionalProperties === true || additionalProperties === undefined) {
        repaired[key] = normalizeMissingValues(rawValue);
        continue;
      }
      this.log("Dropped extra property not covered by schema", keyPath);
    }

    if (typeof schema.minProperties === "number" && Object.keys(repaired).length < schema.minProperties) {
      throw new Error(`Object at ${path} does not meet minProperties.`);
    }
    return repaired;
  }

  public mapListToObject(value: unknown[], schema: JsonSchemaObject, path: string): Record<string, JsonValue> | null {
    const properties = schema.properties;
    if (!properties || typeof properties !== "object" || Array.isArray(properties) || Object.keys(properties).length === 0) {
      return null;
    }
    const typedProperties = properties as Record<string, JsonSchema>;
    const keys = Object.keys(typedProperties);
    if (value.length !== keys.length) {
      return null;
    }
    const mapped: Record<string, JsonValue> = {};
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      try {
        mapped[key] = this.repairValue(value[index], typedProperties[key], `${path}.${key}`);
      } catch (error) {
        if (error instanceof SchemaDefinitionError) {
          throw error;
        }
        return null;
      }
    }
    this.log("Mapped array to object by schema property order", path);
    return mapped;
  }

  public fillMissingRequiredForSalvage(schema: JsonSchema, path: string): [boolean, JsonValue] {
    const resolved = this.resolveSchema(schema);
    if (resolved === true || resolved === false) {
      return [false, ""];
    }
    if ("default" in resolved) {
      return [true, this.copyJsonValue((resolved as Record<string, unknown>).default, path, "default")];
    }
    if ("const" in resolved) {
      return [true, this.copyJsonValue((resolved as Record<string, unknown>).const, path, "const")];
    }
    if (Array.isArray(resolved.enum) && resolved.enum.length > 0) {
      return [true, this.copyJsonValue(resolved.enum[0], path, "enum")];
    }

    let expectedType = resolved.type;
    if (expectedType === undefined) {
      if (this.isArraySchema(resolved)) {
        expectedType = "array";
      } else if (this.isObjectSchema(resolved)) {
        expectedType = "object";
      }
    }
    if (expectedType === "array" && !resolved.minItems) {
      return [true, []];
    }
    if (expectedType === "object" && !resolved.minProperties) {
      return [true, {}];
    }
    return [false, ""];
  }

  public fillMissing(schema: JsonSchemaObject, path: string): JsonValue {
    if ("const" in schema) {
      this.log("Filled missing value with const", path);
      return this.copyJsonValue((schema as Record<string, unknown>).const, path, "const");
    }
    if (Array.isArray(schema.enum)) {
      if (schema.enum.length === 0) {
        throw new Error(`Enum at ${path} has no values.`);
      }
      this.log("Filled missing value with first enum value", path);
      return this.copyJsonValue(schema.enum[0], path, "enum");
    }
    if ("default" in schema) {
      this.log("Filled missing value with default", path);
      return this.copyJsonValue((schema as Record<string, unknown>).default, path, "default");
    }

    let expectedType = schema.type;
    if (Array.isArray(expectedType)) {
      for (const schemaType of expectedType) {
        try {
          return this.fillMissing({ ...schema, type: schemaType }, path);
        } catch {}
      }
      throw new Error(`Cannot infer missing value at ${path}.`);
    }
    if (expectedType === undefined) {
      if (this.isObjectSchema(schema)) {
        expectedType = "object";
      } else if (this.isArraySchema(schema)) {
        expectedType = "array";
      }
    }

    if (expectedType === "string") {
      this.log("Filled missing value with empty string", path);
      return "";
    }
    if (expectedType === "integer" || expectedType === "number") {
      this.log("Filled missing value with 0", path);
      return 0;
    }
    if (expectedType === "boolean") {
      this.log("Filled missing value with false", path);
      return false;
    }
    if (expectedType === "array") {
      if (typeof schema.minItems === "number" && schema.minItems > 0) {
        throw new Error(`Array at ${path} requires at least ${schema.minItems} items.`);
      }
      this.log("Filled missing value with empty array", path);
      return [];
    }
    if (expectedType === "object") {
      if (typeof schema.minProperties === "number" && schema.minProperties > 0) {
        throw new Error(`Object at ${path} requires at least ${schema.minProperties} properties.`);
      }
      this.log("Filled missing value with empty object", path);
      return {};
    }
    if (expectedType === "null") {
      this.log("Filled missing value with null", path);
      return null;
    }
    throw new Error(`Cannot infer missing value at ${path}.`);
  }

  public coerceScalar(value: unknown, schemaType: string, path: string): JsonValue {
    if (schemaType === "string") {
      if (typeof value === "string") {
        return value;
      }
      if ((typeof value === "number" || typeof value === "bigint") && typeof value !== "boolean") {
        this.log("Coerced number to string", path);
        return String(value);
      }
      throw new Error(`Expected string at ${path}.`);
    }
    if (schemaType === "integer") {
      if (typeof value === "boolean") {
        throw new Error(`Expected integer at ${path}.`);
      }
      if (typeof value === "number" && Number.isInteger(value)) {
        return value;
      }
      if (typeof value === "string") {
        if (/^-?\d+$/u.test(value)) {
          this.log("Coerced string to integer", path);
          return Number(value);
        }
        const floatValue = Number(value);
        if (!Number.isNaN(floatValue) && Number.isInteger(floatValue)) {
          this.log("Coerced number to integer", path);
          return floatValue;
        }
      }
      if (typeof value === "number" && Number.isInteger(value)) {
        return value;
      }
      if (typeof value === "number" && Number.isInteger(value)) {
        this.log("Coerced number to integer", path);
        return Math.trunc(value);
      }
      throw new Error(`Expected integer at ${path}.`);
    }
    if (schemaType === "number") {
      if (typeof value === "boolean") {
        throw new Error(`Expected number at ${path}.`);
      }
      if (typeof value === "number") {
        return value;
      }
      if (typeof value === "string") {
        const floatValue = Number(value);
        if (!Number.isNaN(floatValue)) {
          this.log("Coerced string to number", path);
          return floatValue;
        }
      }
      throw new Error(`Expected number at ${path}.`);
    }
    if (schemaType === "boolean") {
      if (typeof value === "boolean") {
        return value;
      }
      if (typeof value === "string") {
        const lowered = value.toLowerCase();
        if (["true", "yes", "y", "on", "1"].includes(lowered)) {
          this.log("Coerced string to boolean", path);
          return true;
        }
        if (["false", "no", "n", "off", "0"].includes(lowered)) {
          this.log("Coerced string to boolean", path);
          return false;
        }
      }
      if (typeof value === "number" && (value === 0 || value === 1)) {
        this.log("Coerced number to boolean", path);
        return Boolean(value);
      }
      throw new Error(`Expected boolean at ${path}.`);
    }
    if (schemaType === "null") {
      if (value === null) {
        return null;
      }
      throw new Error(`Expected null at ${path}.`);
    }
    throw new SchemaDefinitionError(`Unsupported schema type ${schemaType} at ${path}.`);
  }

  public applyEnumConst(value: JsonValue, schema: JsonSchemaObject, path: string): JsonValue {
    if ("const" in schema && value !== (schema as Record<string, unknown>).const) {
      throw new Error(`Value at ${path} does not match const.`);
    }
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
      throw new Error(`Value at ${path} does not match enum.`);
    }
    return value;
  }

  public resolveRef(ref: string): JsonSchema {
    if (!ref.startsWith("#/")) {
      throw new SchemaDefinitionError(`Unsupported $ref: ${ref}`);
    }
    const parts = ref.replace(/^#\//u, "").split("/");
    let current: unknown = this.rootSchema;
    for (const part of parts) {
      const resolvedPart = part.replace(/~1/gu, "/").replace(/~0/gu, "~");
      if (!current || typeof current !== "object" || Array.isArray(current) || !(resolvedPart in current)) {
        throw new SchemaDefinitionError(`Unresolvable $ref: ${ref}`);
      }
      current = (current as Record<string, unknown>)[resolvedPart];
    }
    if (current === true || current === false || (current && typeof current === "object" && !Array.isArray(current))) {
      return current as JsonSchema;
    }
    throw new SchemaDefinitionError(`Unresolvable $ref: ${ref}`);
  }

  public copyJsonValue(value: unknown, path: string, label: string): JsonValue {
    value = unwrapNodeValue(value);
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "bigint"
    ) {
      return value as JsonValue;
    }
    if (Array.isArray(value)) {
      return value.map((item, index) => this.copyJsonValue(item, `${path}[${index}]`, label));
    }
    if (value && typeof value === "object") {
      const copied: Record<string, JsonValue> = {};
      for (const [key, item] of Object.entries(value)) {
        if (typeof key !== "string") {
          throw new Error(`${capitalize(label)} value at ${path} contains a non-string key.`);
        }
        copied[key] = this.copyJsonValue(item, `${path}.${key}`, label);
      }
      return copied;
    }
    throw new Error(`${capitalize(label)} value at ${path} is not JSON compatible.`);
  }

  public prepareSchemaForValidation(schema: unknown): JsonSchemaObject {
    const normalized = prepareSchemaForValidationNode(schema);
    if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
      throw new Error("Schema must be an object.");
    }
    return normalized as JsonSchemaObject;
  }

  private repairUnion(value: unknown, schemas: JsonSchema[], path: string): JsonValue {
    let lastError: Error | undefined;
    for (const subschema of schemas) {
      try {
        const candidate = this.repairValue(deepClone(value), subschema, path);
        this.validate(candidate, subschema);
        return candidate;
      } catch (error) {
        lastError = error as Error;
      }
    }
    throw new Error(lastError?.message ?? "No schema matched the value.");
  }

  private repairTypeUnion(value: unknown, types: string[], schema: JsonSchemaObject, path: string): JsonValue {
    let lastError: Error | undefined;
    for (const schemaType of types) {
      const branchSchema = { ...schema, type: schemaType };
      try {
        let candidate: JsonValue;
        if (schemaType === "array") {
          candidate = this.repairArray(deepClone(value), schema, path);
        } else if (schemaType === "object") {
          candidate = this.repairObject(deepClone(value), schema, path);
        } else {
          candidate = this.coerceScalar(deepClone(value), schemaType, path);
        }
        candidate = this.applyEnumConst(candidate, branchSchema, path);
        this.validate(candidate, branchSchema);
        return candidate;
      } catch (error) {
        lastError = error as Error;
      }
    }
    throw new Error(lastError?.message ?? "No schema type matched the value.");
  }

  private allowsSchemaType(schema: JsonSchemaObject, schemaType: string): boolean {
    const declared = schema.type;
    if (typeof declared === "string") {
      return declared === schemaType;
    }
    if (Array.isArray(declared)) {
      return declared.includes(schemaType);
    }
    if (schemaType === "object") {
      return this.isObjectSchema(schema);
    }
    return this.isArraySchema(schema);
  }
}

function deepClone<T>(value: T): T {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
