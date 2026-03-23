import { describe, expect, it } from "vitest";

import { handleRepairJsonRequest } from "../src/index";

describe("docs api parity", () => {
  it("returns repaired value and logs from a repair-json endpoint", async () => {
    const response = handleRepairJsonRequest({
      malformedJSON: '{"value":"1"}',
      schema: { type: "object", properties: { value: { type: "integer" } }, required: ["value"] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual([{ value: 1 }, expect.any(Array)]);
  });

  it("rejects invalid schema and schemaRepairMode inputs with 400s", async () => {
    expect(handleRepairJsonRequest({ malformedJSON: '{"value":"1"}', schema: [] }).statusCode).toBe(400);
    expect(handleRepairJsonRequest({ malformedJSON: '{"value":"1"}', schemaRepairMode: true }).statusCode).toBe(400);
    expect(handleRepairJsonRequest({ malformedJSON: '{"value":"1"}', schemaRepairMode: "unknown" }).statusCode).toBe(400);
  });

  it("accepts salvage mode for schema-guided array repair", async () => {
    const response = handleRepairJsonRequest({
      malformedJSON: '{"items":[{"id":1,"score":85.6},{"id":2,"score":"N/A"}]}',
      schema: {
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
      },
      schemaRepairMode: "salvage",
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual([{ items: [{ id: 1, score: 85.6 }] }, expect.any(Array)]);
  });
});
