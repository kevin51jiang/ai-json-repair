import type { JsonNode } from "../types";

export const STRING_DELIMITERS = ['"', "'", "“", "”"] as const;

export class MissingValueType {
  public toString(): string {
    return "<MISSING_VALUE>";
  }
}

export const MISSING_VALUE = new MissingValueType();

export type ParserValue = JsonNode | MissingValueType;
