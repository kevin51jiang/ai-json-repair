# ai-json-repair

TypeScript/JavaScript port of [mangiucugna/json_repair](https://github.com/mangiucugna/json_repair).

## Installation

```bash
npm install ai-json-repair
```

The main API is intentionally simple:

```ts
import { jsonRepair } from "ai-json-repair";

const fixed = jsonRepair(`{name: "Ada", skills: [ts python]}`);
// {"name": "Ada", "skills": ["ts", "python"]}
```

If you want the repaired value as a JavaScript object:

```ts
import { jsonRepair, loads } from "ai-json-repair";

const value = jsonRepair(`{name: Ada, active: TRUE}`, { returnObjects: true });
const sameValue = loads(`{name: Ada, active: TRUE}`);
```

## API

```ts
jsonRepair(input: string, options?)
jsonRepair.parse(input: string, options?)
loads(input: string, options?)
fromFile(path: string, options?)
```

## CLI

After installation, the package exposes a `json-repair` command:

```bash
json-repair broken.json
json-repair broken.json --inline
json-repair broken.json --output fixed.json
cat broken.json | json-repair --indent 2
```

Supported CLI flags:

- `-i`, `--inline`
- `-o`, `--output <file>`
- `--indent <number>`
- `--ensure-ascii`
- `--skip-json-parse`
- `--strict`
- `--schema <file>`
- `--schema-module <path:exportName>`
- `--schema-repair-mode <repair|salvage>`

Supported core options:

- `returnObjects`
- `skipJsonParse`
- `streamStable`
- `logging`
- `strict`
- `schema`
- `schemaRepairMode`
- `ensureAscii`
- `indent`

## JSON Schema

You can guide repairs with a JSON Schema:

```ts
import { jsonRepair } from "ai-json-repair";

const schema = {
  type: "object",
  properties: {
    value: { type: "integer" },
  },
  required: ["value"],
};

jsonRepair('{"value":"1"}', { schema, returnObjects: true });
// { value: 1 }
```

`schemaRepairMode: "salvage"` keeps valid portions of partially-bad structured data when possible:

```ts
jsonRepair('{"items":[{"id":1},{"id":"oops"}]}', {
  schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "integer" } },
          required: ["id"],
        },
      },
    },
    required: ["items"],
  },
  schemaRepairMode: "salvage",
  returnObjects: true,
});
```

If you want to load a schema from a module, use `loadSchemaModule("path/to/schema.mjs:exportName")`.
Besides plain schema objects, exported classes or objects with a `toJSONSchema()` method are also accepted.

## Development

```bash
pnpm install
pnpm check
pnpm test
pnpm build
```
