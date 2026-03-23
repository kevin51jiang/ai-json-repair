import { jsonRepair } from "./jsonRepair";
import { normalizeSchemaRepairMode } from "./schema/schemaRepair";

export interface RepairJsonResponse {
  body: unknown;
  statusCode: number;
}

export function handleRepairJsonRequest(body: unknown): RepairJsonResponse {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { statusCode: 400, body: { error: "Request JSON must be an object." } };
  }

  const requestBody = body as Record<string, unknown>;

  const malformedJSON = requestBody.malformedJSON;
  if (typeof malformedJSON !== "string") {
    return { statusCode: 400, body: { error: "malformedJSON must be a string." } };
  }

  const schema = requestBody.schema;
  if (schema !== undefined && schema !== null && schema !== true && schema !== false && (typeof schema !== "object" || Array.isArray(schema))) {
    return { statusCode: 400, body: { error: "schema must be a JSON object or boolean." } };
  }

  const schemaRepairMode = requestBody.schemaRepairMode;
  if (schemaRepairMode !== undefined && typeof schemaRepairMode !== "string") {
    return { statusCode: 400, body: { error: "schemaRepairMode must be a string." } };
  }

  try {
    const normalizedMode = normalizeSchemaRepairMode(schemaRepairMode);
    const repaired = jsonRepair(malformedJSON, {
      logging: true,
      returnObjects: true,
      schema: schema === null ? undefined : (schema as never),
      schemaRepairMode: normalizedMode,
    }) as [unknown, unknown[]];
    return { statusCode: 200, body: repaired };
  } catch (error) {
    return { statusCode: 400, body: { error: (error as Error).message } };
  }
}
