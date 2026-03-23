import type { JsonNode, JsonSchema, RepairLog } from "../types";
import type { SchemaRepairer } from "../schema/schemaRepair";
import { STRING_DELIMITERS } from "./constants";
import { JsonContext } from "./context";
import { ObjectComparer } from "./objectComparer";
import { parseArray } from "./parseArray";
import { parseComment } from "./parseComment";
import { parseNumber } from "./parseNumber";
import { parseObject } from "./parseObject";
import { parseString } from "./parseString";

export class JsonRepairParser {
  public source: string;
  public index = 0;
  public context = new JsonContext();
  public logger: RepairLog[] = [];
  public schemaRepairer: SchemaRepairer | null = null;

  public constructor(
    source: string,
    public readonly logging = false,
    public readonly streamStable = false,
    public readonly strict = false,
  ) {
    this.source = source;
  }

  public parse(): JsonNode {
    return this.parseTopLevel(() => this.parseJson());
  }

  public parseWithSchema(repairer: SchemaRepairer, schema: JsonSchema): JsonNode {
    this.schemaRepairer = repairer;
    return this.parseTopLevel(() => this.parseJson(schema, "$"));
  }

  public parseArray(schema?: JsonSchema, path = "$"): JsonNode[] {
    return parseArray(this, schema, path);
  }

  public parseComment() {
    return parseComment(this);
  }

  public parseNumber() {
    return parseNumber(this);
  }

  public parseObject(schema?: JsonSchema, path = "$") {
    return parseObject(this, schema, path);
  }

  public parseString() {
    return parseString(this);
  }

  public parseJson(schema?: JsonSchema, path = "$"): JsonNode {
    const repairer = this.schemaRepairer && schema !== undefined && schema !== true ? this.schemaRepairer : null;
    let resolvedSchema = schema;
    if (repairer) {
      resolvedSchema = repairer.resolveSchema(schema);
      if (resolvedSchema === true) {
        resolvedSchema = undefined;
      } else if (resolvedSchema === false) {
        throw new Error("Schema does not allow any values.");
      }
    }

    while (true) {
      const char = this.getCharAt();
      if (char === undefined) {
        return "";
      }
      if (char === "{") {
        this.index += 1;
        const value = repairer ? this.parseObject(resolvedSchema, path) : this.parseObject();
        return repairer && resolvedSchema !== undefined ? repairer.repairValue(value, resolvedSchema, path) : value;
      }
      if (char === "[") {
        this.index += 1;
        const value = repairer ? this.parseArray(resolvedSchema, path) : this.parseArray();
        return repairer && resolvedSchema !== undefined ? repairer.repairValue(value, resolvedSchema, path) : value;
      }
      if (
        !this.context.empty &&
        (STRING_DELIMITERS.includes(char as (typeof STRING_DELIMITERS)[number]) || /[A-Za-z]/u.test(char))
      ) {
        const value = this.parseString();
        return repairer && resolvedSchema !== undefined ? repairer.repairValue(value, resolvedSchema, path) : value;
      }
      if (!this.context.empty && (/[0-9]/u.test(char) || char === "-" || char === ".")) {
        const value = this.parseNumber();
        return repairer && resolvedSchema !== undefined ? repairer.repairValue(value, resolvedSchema, path) : value;
      }
      if (char === "#" || char === "/") {
        const value = this.parseComment();
        return repairer && resolvedSchema !== undefined ? repairer.repairValue(value, resolvedSchema, path) : value;
      }

      this.index += 1;
    }
  }

  public getCharAt(count = 0): string | undefined {
    return this.source[this.index + count];
  }

  public skipWhitespaces(): void {
    while (this.getCharAt() && /\s/u.test(this.getCharAt()!)) {
      this.index += 1;
    }
  }

  public scrollWhitespaces(offset = 0): number {
    while (this.getCharAt(offset) && /\s/u.test(this.getCharAt(offset)!)) {
      offset += 1;
    }
    return offset;
  }

  public skipToCharacter(character: string | string[], offset = 0): number {
    const targets = new Set(Array.isArray(character) ? character : [character]);
    let cursor = this.index + offset;
    let backslashes = 0;

    while (cursor < this.source.length) {
      const current = this.source[cursor]!;
      if (current === "\\") {
        backslashes += 1;
        cursor += 1;
        continue;
      }
      if (targets.has(current) && backslashes % 2 === 0) {
        return cursor - this.index;
      }
      backslashes = 0;
      cursor += 1;
    }

    return this.source.length - this.index;
  }

  public log(text: string): void {
    if (!this.logging) {
      return;
    }
    const window = 10;
    const start = Math.max(this.index - window, 0);
    const end = Math.min(this.index + window, this.source.length);
    this.logger.push({
      context: this.source.slice(start, end),
      text,
    });
  }

  private isTruthyValue(value: JsonNode): boolean {
    if (value === null || value === false || value === 0 || value === 0n || value === "") {
      return false;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    if (typeof value === "object") {
      return Object.keys(value).length > 0;
    }
    return true;
  }

  private parseTopLevel(parseElement: () => JsonNode): JsonNode {
    let json = parseElement();
    if (this.index < this.source.length) {
      this.log("The parser returned early, checking if there's more json elements");
      const items: JsonNode[] = [json];
      while (this.index < this.source.length) {
        this.context.reset();
        const next = parseElement();
        if (this.isTruthyValue(next)) {
          const last = items[items.length - 1];
          if (ObjectComparer.isSameObject(last, next)) {
            items.pop();
          } else if (last !== undefined && !this.isTruthyValue(last)) {
            items.pop();
          }
          items.push(next);
        } else {
          this.index += 1;
        }
      }
      if (items.length === 1) {
        this.log("There were no more elements, returning the element without the array");
        [json] = items;
      } else if (this.strict) {
        this.log("Multiple top-level JSON elements found in strict mode, raising an error");
        throw new Error("Multiple top-level JSON elements found in strict mode.");
      } else {
        json = items;
      }
    }
    return json;
  }
}
