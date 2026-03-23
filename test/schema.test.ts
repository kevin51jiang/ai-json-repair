import { describe, expect, it } from "vitest";

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as z from "zod";

import { ContextValue } from "../src/parser/context";
import {
  JsonRepairParser,
  MISSING_VALUE,
  SchemaRepairer,
  jsonRepair,
  loadSchemaModule,
  normalizeMissingValues,
  normalizeSchemaRepairMode,
  schemaFromInput,
} from "../src/index";

function repairWithSchema(raw: string, schema: unknown, options: Record<string, unknown> = {}) {
  return jsonRepair(raw, {
    schema,
    skipJsonParse: true,
    returnObjects: true,
    ...options,
  } as never);
}

function parseObjectDirect(raw: string, schema: unknown, options: { strict?: boolean; context?: ContextValue } = {}) {
  const parser = new JsonRepairParser(raw, true, false, options.strict ?? false);
  parser.schemaRepairer = new SchemaRepairer(schemaFromInput(schema), parser.logger);
  if (options.context) {
    parser.context.set(options.context);
  }
  parser.index = 1;
  return parser.parseObject(schemaFromInput(schema), "$");
}

function parseArrayDirect(raw: string, schema: unknown, mode: "standard" | "salvage" = "standard") {
  const parser = new JsonRepairParser(raw, true);
  parser.schemaRepairer = new SchemaRepairer(schemaFromInput(schema), parser.logger, mode);
  parser.index = 1;
  return parser.parseArray(schemaFromInput(schema), "$");
}

describe("schema helpers", () => {
  it("normalizes missing values and schema modes", () => {
    expect(normalizeMissingValues(MISSING_VALUE)).toBe("");
    expect(normalizeMissingValues({ a: MISSING_VALUE, b: [MISSING_VALUE, 1] })).toEqual({ a: "", b: ["", 1] });
    expect(() => normalizeMissingValues(() => "nope")).toThrow("JSON compatible");

    expect(normalizeSchemaRepairMode(undefined)).toBe("standard");
    expect(normalizeSchemaRepairMode("standard")).toBe("standard");
    expect(normalizeSchemaRepairMode("salvage")).toBe("salvage");
    expect(() => normalizeSchemaRepairMode("unknown")).toThrow("schema_repair_mode");
  });

  it("accepts schema objects and booleans and rejects invalid schema input", () => {
    expect(schemaFromInput({ type: "string" })).toEqual({ type: "string" });
    expect(schemaFromInput(true)).toBe(true);
    expect(schemaFromInput(false)).toBe(false);
    expect(
      schemaFromInput({
        toJSONSchema() {
          return { type: "integer" };
        },
      }),
    ).toEqual({ type: "integer" });
    expect(() => schemaFromInput(1)).toThrow("Schema must be a JSON Schema");
  });

  it("loads schema modules using a JS-native modulePath:exportName format", async () => {
    const dir = mkdtempSync(join(tmpdir(), "json-repair-schema-"));
    const modulePath = join(dir, "schema.mjs");
    writeFileSync(
      modulePath,
      'export const payloadSchema = { type: "object", properties: { value: { type: "integer" } }, required: ["value"] }; export class PayloadSchemaModel { static toJSONSchema() { return payloadSchema; } }',
      "utf8",
    );

    await expect(loadSchemaModule("invalid")).rejects.toThrow("modulePath:exportName");
    await expect(loadSchemaModule(`${modulePath}:payloadSchema`)).resolves.toEqual({
      type: "object",
      properties: { value: { type: "integer" } },
      required: ["value"],
    });
    await expect(loadSchemaModule(`${modulePath}:PayloadSchemaModel`)).resolves.toEqual({
      type: "object",
      properties: { value: { type: "integer" } },
      required: ["value"],
    });
    await expect(loadSchemaModule(`${modulePath}:missingSchema`)).rejects.toThrow("not found");
  });

  it("accepts basic Zod 4 JSON Schema conversions", async () => {
    const zodSchema = z.object({
      name: z.string(),
      age: z.number(),
    });
    const jsonSchema = z.toJSONSchema(zodSchema);

    expect(schemaFromInput(jsonSchema)).toEqual(jsonSchema);
    expect(repairWithSchema('{"name":"Ada","age":"42"}', jsonSchema)).toEqual({
      name: "Ada",
      age: 42,
    });
  });

  it("accepts Zod-backed schema adapters exposing toJSONSchema()", async () => {
    const schemaAdapter = {
      toJSONSchema() {
        return z.toJSONSchema(
          z.object({
            active: z.boolean(),
            count: z.number(),
          }),
        );
      },
    };

    expect(repairWithSchema('{"active":"yes","count":"2"}', schemaAdapter)).toEqual({
      active: true,
      count: 2,
    });
  });

  it("loads Zod-backed schema modules through loadSchemaModule", async () => {
    const dir = mkdtempSync(join(tmpdir(), "json-repair-zod-schema-"));
    const modulePath = join(dir, "schema.mjs");
    writeFileSync(
      modulePath,
      [
        'import * as z from "zod";',
        'export const zodJsonSchema = z.toJSONSchema(z.object({ value: z.number() }));',
        'export class ZodSchemaModel {',
        '  static toJSONSchema() {',
        '    return z.toJSONSchema(z.object({ label: z.string() }));',
        "  }",
        "}",
      ].join("\n"),
      "utf8",
    );

    await expect(loadSchemaModule(`${modulePath}:zodJsonSchema`)).resolves.toEqual(
      z.toJSONSchema(z.object({ value: z.number() })),
    );
    await expect(loadSchemaModule(`${modulePath}:ZodSchemaModel`)).resolves.toEqual(
      z.toJSONSchema(z.object({ label: z.string() })),
    );
  });
});

describe("SchemaRepairer", () => {
  it("validates values, caches validators, and prepares tuple schemas for Ajv", () => {
    const repairer = new SchemaRepairer({}, []);
    expect(repairer.isValid(1, true)).toBe(true);
    expect(repairer.isValid(1, false)).toBe(false);
    expect(() => repairer.validate(1, false)).toThrow("Schema does not allow");

    const integerSchema = { type: "integer" };
    repairer.validate(1, integerSchema);
    expect(repairer.getValidator(integerSchema)).toBe(repairer.getValidator(integerSchema));
    expect(() => repairer.validate("x", integerSchema)).toThrow("integer");

    const tupleSchema = {
      type: "array",
      items: [{ type: "integer" }, { type: "string" }],
      additionalItems: false,
    };
    const prepared = repairer.prepareSchemaForValidation(tupleSchema);
    expect(prepared.prefixItems).toEqual(tupleSchema.items);
    expect(prepared.items).toBe(false);
    expect(() => repairer.prepareSchemaForValidation(true)).toThrow("Schema must be an object");
  });

  it("resolves refs and identifies object and array schemas", () => {
    const rootSchema = {
      defs: { node: { type: "string" } },
      flag: true,
      flagFalse: false,
      bad: 1,
    };
    const repairer = new SchemaRepairer(rootSchema, null);

    expect(repairer.resolveSchema(undefined)).toBe(true);
    expect(repairer.resolveSchema(false)).toBe(false);
    expect(repairer.resolveSchema({ $ref: "#/defs/node" })).toEqual({ type: "string" });
    expect(repairer.resolveSchema({ $ref: "#/flag" })).toBe(true);
    expect(repairer.resolveSchema({ $ref: "#/flagFalse" })).toBe(false);
    expect(() => repairer.resolveSchema("nope")).toThrow("Schema must be an object");
    expect(() => repairer.resolveRef("http://example.com")).toThrow("Unsupported $ref");
    expect(() => repairer.resolveRef("#/missing")).toThrow("Unresolvable $ref");
    expect(() => repairer.resolveRef("#/bad")).toThrow("Unresolvable $ref");

    expect(repairer.isObjectSchema({ type: "object" })).toBe(true);
    expect(repairer.isObjectSchema({ type: ["null", "object"] })).toBe(true);
    expect(repairer.isObjectSchema({ properties: {} })).toBe(true);
    expect(repairer.isObjectSchema({ type: "string" })).toBe(false);
    expect(repairer.isArraySchema({ type: "array" })).toBe(true);
    expect(repairer.isArraySchema({ type: ["array", "null"] })).toBe(true);
    expect(repairer.isArraySchema({ items: { type: "string" } })).toBe(true);
    expect(repairer.isArraySchema({ type: "object" })).toBe(false);
  });

  it("repairs missing values, unions, enums, consts, and scalar coercions", () => {
    const repairer = new SchemaRepairer({}, []);

    expect(repairer.repairValue(MISSING_VALUE, { const: 1 }, "$")).toBe(1);
    expect(repairer.repairValue(MISSING_VALUE, { enum: [2, 3] }, "$")).toBe(2);
    expect(repairer.repairValue(MISSING_VALUE, { default: "x" }, "$")).toBe("x");
    expect(repairer.repairValue(MISSING_VALUE, { type: "string" }, "$")).toBe("");
    expect(repairer.repairValue("1", { anyOf: [{ type: "integer" }, { type: "string" }] }, "$")).toBe(1);
    expect(repairer.repairValue("a", { allOf: [{ type: "string" }, { enum: ["a"] }] }, "$")).toBe("a");
    expect(repairer.repairValue("2", { type: ["integer", "string"] }, "$")).toBe(2);
    expect(repairer.repairValue(["1"], { type: ["array", "string"], items: { type: "integer" } }, "$")).toEqual([1]);
    expect(
      repairer.repairValue({ a: "1" }, { type: ["object", "string"], properties: { a: { type: "integer" } } }, "$"),
    ).toEqual({ a: 1 });

    expect(repairer.fillMissing({ type: "integer" }, "$")).toBe(0);
    expect(repairer.fillMissing({ type: "boolean" }, "$")).toBe(false);
    expect(repairer.fillMissing({ type: "array" }, "$")).toEqual([]);
    expect(repairer.fillMissing({ type: "object" }, "$")).toEqual({});
    expect(repairer.fillMissing({ type: ["string", "integer"] }, "$")).toBe("");
    expect(() => repairer.fillMissing({ type: "array", minItems: 1 }, "$")).toThrow("requires at least");
    expect(() => repairer.fillMissing({ type: "custom" }, "$")).toThrow("Cannot infer missing value");

    expect(repairer.coerceScalar(1, "string", "$")).toBe("1");
    expect(repairer.coerceScalar("2", "integer", "$")).toBe(2);
    expect(repairer.coerceScalar("2.0", "integer", "$")).toBe(2);
    expect(repairer.coerceScalar(2.5, "number", "$")).toBe(2.5);
    expect(repairer.coerceScalar("yes", "boolean", "$")).toBe(true);
    expect(repairer.coerceScalar("0", "boolean", "$")).toBe(false);
    expect(repairer.coerceScalar(1, "boolean", "$")).toBe(true);
    expect(repairer.coerceScalar(null, "null", "$")).toBeNull();
    expect(() => repairer.coerceScalar("maybe", "boolean", "$")).toThrow("Expected boolean");
    expect(() => repairer.coerceScalar("x", "unsupported", "$")).toThrow("Unsupported schema type");

    expect(() => repairer.repairValue("nope", { oneOf: [{ type: "integer" }, { type: "boolean" }] }, "$")).toThrow(
      "Expected boolean",
    );
    expect(() => repairer.repairValue("x", { oneOf: [] }, "$")).toThrow("No schema matched");
    expect(() => repairer.repairValue("x", { type: [] }, "$")).toThrow("No schema type matched");
    expect(() => repairer.repairValue("b", { const: "a" }, "$")).toThrow("does not match const");
    expect(() => repairer.repairValue("b", { enum: ["a"] }, "$")).toThrow("does not match enum");
  });

  it("repairs objects and arrays and applies salvage-mode heuristics", () => {
    const repairer = new SchemaRepairer({}, []);
    const salvageRepairer = new SchemaRepairer({}, [], "salvage");

    expect(
      repairer.repairValue(
        { a: "1", x1: "2", extra: "drop" },
        {
          type: "object",
          properties: {
            a: { type: "integer" },
            b: { type: "string", default: "x" },
          },
          required: ["a"],
          patternProperties: {
            "^x": { type: "integer" },
            "1$": { type: "integer" },
          },
          additionalProperties: false,
        },
        "$",
      ),
    ).toEqual({ a: 1, b: "x", x1: 2 });

    expect(repairer.repairValue({ a: "1" }, { type: "object", additionalProperties: { type: "integer" } }, "$")).toEqual({
      a: 1,
    });
    expect(() => repairer.repairValue({}, { type: "object", minProperties: 1 }, "$")).toThrow("minProperties");
    expect(() => repairer.repairValue([], { type: "object" }, "$")).toThrow("Expected object");

    expect(
      repairer.repairValue([1, 2], { type: "array", items: [{ type: "integer" }], additionalItems: false }, "$"),
    ).toEqual([1]);
    expect(
      repairer.repairValue([1, 2], { type: "array", items: [{ type: "integer" }], additionalItems: { type: "string" } }, "$"),
    ).toEqual([1, "2"]);
    expect(repairer.repairValue(["1", 2], { type: "array", items: { type: "integer" } }, "$")).toEqual([1, 2]);
    expect(repairer.repairValue("a", { type: "array" }, "$")).toEqual(["a"]);
    expect(() => repairer.repairValue([], { type: "array", minItems: 1 }, "$")).toThrow("minItems");

    expect(salvageRepairer.canSalvageListAsObject({ properties: { a: { type: "integer" } } })).toBe(true);
    expect(salvageRepairer.canSalvageListAsObject({ items: { type: "integer" } })).toBe(false);
    expect(
      salvageRepairer.repairValue(["hello", ["a", "b"]], {
        type: "object",
        properties: {
          name: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["name", "tags"],
      }, "$"),
    ).toEqual({ name: "hello", tags: ["a", "b"] });
    expect(salvageRepairer.repairValue(["bad"], { type: "array", items: [{ type: "integer" }] }, "$")).toEqual([]);
    expect(
      salvageRepairer.repairValue([1, "bad"], {
        type: "array",
        items: [{ type: "integer" }],
        additionalItems: { type: "integer" },
      }, "$"),
    ).toEqual([1]);
  });
});

describe("schema-guided parsing", () => {
  it("fills missing typed values and inserts optional defaults", () => {
    const schema = {
      type: "object",
      properties: {
        text: { type: "string" },
        count: { type: "integer" },
        ratio: { type: "number" },
        flag: { type: "boolean" },
        items: { type: "array", items: { type: "string" } },
        payload: { type: "object" },
        nothing: { type: "null" },
        note: { type: "string", default: "n/a" },
      },
      required: ["text", "count", "ratio", "flag", "items", "payload", "nothing"],
    };

    expect(repairWithSchema('{ "text": , "count": , "ratio": , "flag": , "items": , "payload": , "nothing": }', schema)).toEqual({
      text: "",
      count: 0,
      ratio: 0,
      flag: false,
      items: [],
      payload: {},
      nothing: null,
      note: "n/a",
    });
  });

  it("raises for missing required properties in standard mode", () => {
    const schema = {
      type: "object",
      properties: { required_value: { type: "integer", default: 1 } },
      required: ["required_value"],
    };

    expect(() => repairWithSchema("{}", schema)).toThrow("Missing required properties");
  });

  it("applies schema on the native JSON fast path and keeps logging sensible", () => {
    const schema = {
      type: "object",
      properties: { value: { type: "integer" } },
      required: ["value"],
    };

    expect(jsonRepair('{"value": "1"}', { schema, returnObjects: true } as never)).toEqual({ value: 1 });
    expect(jsonRepair('"1"', { schema: { type: "integer" }, returnObjects: true } as never)).toBe(1);
    expect(jsonRepair("true", { schema: { type: "string" }, returnObjects: true } as never)).toBe("");
    expect(jsonRepair('""', { schema: { type: "string" } } as never)).toBe('""');

    expect(jsonRepair('{"value": 1}', { schema } as never)).toBe('{"value": 1}');
    expect(jsonRepair('{"value": "1"}', { schema } as never)).toBe('{"value": 1}');

    const [validFastPath, emptyLogs] = jsonRepair('{"value": 1}', {
      schema,
      logging: true,
    } as never) as unknown as [unknown, unknown[]];
    expect(validFastPath).toEqual({ value: 1 });
    expect(emptyLogs).toEqual([]);

    const [repairedFastPath, repairLogs] = jsonRepair('{"value": "1"}', {
      schema,
      logging: true,
    } as never) as unknown as [unknown, unknown[]];
    expect(repairedFastPath).toEqual({ value: 1 });
    expect(repairLogs.length).toBeGreaterThanOrEqual(0);

    expect(() =>
      jsonRepair('"1"', { schema: { type: "integer" }, skipJsonParse: true, returnObjects: true } as never),
    ).toThrow("integer");
  });

  it("enforces schema/strict exclusivity and salvage requiring a schema", () => {
    expect(() => jsonRepair("{}", { schema: {}, strict: true, returnObjects: true } as never)).toThrow("schema and strict");
    expect(() => jsonRepair("{}", { returnObjects: true, schemaRepairMode: "salvage" } as never)).toThrow(
      "schema_repair_mode",
    );
  });

  it("supports salvage mode for arrays, object mapping, and root unwrapping", () => {
    const arraySchema = {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "integer" },
              score: { type: "number" },
            },
            required: ["id", "score"],
          },
        },
      },
      required: ["items"],
    };

    expect(() =>
      repairWithSchema('{"items":[{"id":1,"score":85.6},{"id":2,"score":"N/A"}]}', arraySchema),
    ).toThrow("Expected number");

    expect(
      repairWithSchema('{"items":[{"id":1,"score":85.6},{"id":2,"score":"N/A"}]}', arraySchema, {
        schemaRepairMode: "salvage",
      }),
    ).toEqual({ items: [{ id: 1, score: 85.6 }] });

    expect(
      jsonRepair('{"items":[{"id":1,"score":85.6},{"id":2,"score":"N/A"}]}', {
        schema: arraySchema,
        skipJsonParse: true,
        logging: true,
        schemaRepairMode: "salvage",
      } as never),
    ).toEqual([
      { items: [{ id: 1, score: 85.6 }] },
      [{ context: "$.items[1]", text: "Dropped invalid array item while salvaging" }],
    ]);

    const mappedObjectSchema = {
      type: "object",
      properties: {
        name: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["name", "tags"],
    };

    expect(
      repairWithSchema('["hello", ["a", "b"]]', mappedObjectSchema, { schemaRepairMode: "salvage" }),
    ).toEqual({ name: "hello", tags: ["a", "b"] });
    expect(() =>
      repairWithSchema('["hello"]', mappedObjectSchema, { schemaRepairMode: "salvage" }),
    ).toThrow("Expected object");

    const rootUnwrapSchema = {
      type: "object",
      properties: {
        type: { const: "food_sport_card" },
        content: {
          type: "object",
          required: ["food", "sports"],
          properties: {
            food: { type: "array", items: { type: "string" } },
            sports: { type: "array", items: { type: "string" } },
          },
        },
      },
      required: ["type", "content"],
    };

    expect(() =>
      jsonRepair('[{"type":"food_sport_card","content":{"food":["mantou"]}}]', {
        schema: rootUnwrapSchema,
        returnObjects: true,
      } as never),
    ).toThrow("Expected object");

    expect(
      jsonRepair('[{"type":"food_sport_card","content":{"food":["mantou"]}}]', {
        schema: rootUnwrapSchema,
        returnObjects: true,
        schemaRepairMode: "salvage",
      } as never),
    ).toEqual({
      type: "food_sport_card",
      content: { food: ["mantou"], sports: [] },
    });
  });

  it("exposes schema-aware parser paths for direct object and array parsing", () => {
    expect(parseObjectDirect("{}", true)).toEqual({});
    expect(() => parseObjectDirect("{}", false)).toThrow("Schema does not allow");
    expect(parseObjectDirect("{:a:1}", { type: "object", properties: [], patternProperties: [], additionalProperties: true })).toEqual({
      a: expect.anything(),
    });
    expect(parseObjectDirect("{,,}", { type: "object", additionalProperties: true })).toEqual([]);

    expect(parseArrayDirect("[1]", true)).toEqual([{ raw: "1", value: 1 }]);
    expect(() => parseArrayDirect("[1]", false)).toThrow("Schema does not allow");
    expect(parseArrayDirect('[1, "2"]', { type: "array", items: [{ type: "integer" }], additionalItems: { type: "integer" } })).toEqual([
      1,
      2,
    ]);
    expect(parseArrayDirect('["bad", "2"]', { type: "array", items: { type: "integer" } }, "salvage")).toEqual([
      "bad",
      "2",
    ]);
    expect(
      parseArrayDirect('["a": 1]', { type: "array", items: { type: "object", properties: { a: { type: "integer" } } } }, "salvage"),
    ).toEqual([{ a: { raw: "1", value: 1 } }]);
  });

  it("lets parser.parseJson branch through schema-aware scalar, comment, and ref cases", () => {
    const arraySchema = { type: "array", items: { type: "integer" } };
    const repairer = new SchemaRepairer(arraySchema, null);

    let parser = new JsonRepairParser("[1]");
    parser.schemaRepairer = repairer;
    expect(parser.parseJson(arraySchema, "$")).toEqual([1]);

    parser = new JsonRepairParser('"1"');
    parser.schemaRepairer = repairer;
    parser.context.set(ContextValue.Array);
    expect(parser.parseJson({ type: "integer" }, "$")).toBe(1);

    parser = new JsonRepairParser("1");
    parser.schemaRepairer = repairer;
    parser.context.set(ContextValue.Array);
    expect(parser.parseJson({ type: "integer" }, "$")).toBe(1);

    parser = new JsonRepairParser("# comment");
    parser.schemaRepairer = repairer;
    expect(parser.parseJson({ type: "string" }, "$")).toBe("");

    parser = new JsonRepairParser("");
    parser.schemaRepairer = repairer;
    expect(parser.parseJson({ type: "string" }, "$")).toBe("");

    parser = new JsonRepairParser('"x"');
    parser.schemaRepairer = repairer;
    parser.context.set(ContextValue.Array);
    expect(parser.parseJson(true, "$")).toBe("x");
    expect(() => parser.parseJson(false, "$")).toThrow("Schema does not allow");

    parser = new JsonRepairParser('@{"a": 1}');
    parser.schemaRepairer = new SchemaRepairer({ type: "object" }, null);
    expect(parser.parseJson({ type: "object" }, "$")).toEqual({ a: 1 });

    const refRepairer = new SchemaRepairer({ flag: true }, null);
    parser = new JsonRepairParser("1");
    parser.schemaRepairer = refRepairer;
    parser.context.set(ContextValue.Array);
    expect(parser.parseJson({ $ref: "#/flag" }, "$")).toEqual({ raw: "1", value: 1 });
  });
});
