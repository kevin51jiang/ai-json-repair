# json-repair

TypeScript/JavaScript port of [mangiucugna/json_repair](https://github.com/mangiucugna/json_repair).

The main API is intentionally simple:

```ts
import { jsonRepair } from "json-repair";

const fixed = jsonRepair(`{name: "Ada", skills: [ts python]}`);
// {"name": "Ada", "skills": ["ts", "python"]}
```

If you want the repaired value as a JavaScript object:

```ts
import { jsonRepair, loads } from "json-repair";

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
import { jsonRepair } from "json-repair";

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
