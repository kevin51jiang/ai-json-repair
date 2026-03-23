# ai-json-repair

Repair malformed JSON in TypeScript and JavaScript.

This package is a TypeScript/JavaScript port of the Python project [mangiucugna/json_repair](https://github.com/mangiucugna/json_repair), with a few additions for the Node.js ecosystem:

- a simple JavaScript API
- a bundled CLI
- optional JSON Schema-guided repair
- file helpers for repairing large inputs

## Installation

```bash
pnpm add ai-json-repair
```

The package also ships a `json-repair` CLI, so you can repair files or pipe JSON through stdin.

If you prefer to invoke the CLI without adding it to your project dependencies:

```bash
pnpx ai-json-repair broken.json
```

If you use the tool regularly, installing it globally can be more convenient:

```bash
pnpm add -g ai-json-repair
json-repair broken.json
```

## Quick Start

Repair malformed JSON and get a JSON string back:

```ts
import { jsonRepair } from "ai-json-repair";

const fixed = jsonRepair(`{name: "Ada", skills: [ts python]}`);
// {"name": "Ada", "skills": ["ts", "python"]}
```

If you want a parsed JavaScript value instead, use `returnObjects: true` or `loads()`:

```ts
import { jsonRepair, loads } from "ai-json-repair";

const value = jsonRepair(`{name: Ada, active: TRUE}`, { returnObjects: true });
const sameValue = loads(`{name: Ada, active: TRUE}`);
```

When `logging: true` is enabled, the repair helpers return the repaired value plus a log of applied fixes:

```ts
import { loads } from "ai-json-repair";

const [repairedValue, logs] = loads(`{"name": "Ada"`, { logging: true });
// repairedValue: { name: "Ada" }
// logs: [{ context: "...", text: "..." }, ...]
```

## API

- `jsonRepair(input, options?)`
  Repairs malformed JSON and returns a JSON string by default.
- `loads(input, options?)` and `jsonParse(input, options?)`
  Repair and return a parsed JavaScript value.
- `fromFile(path, options?)`
  Read a file, repair it, and return a parsed JavaScript value.
- `load(fileOrHandle, options?)`
  Repair from a file handle or file-like object.

Common options:

- `returnObjects`: Return a parsed JavaScript value instead of a string.
- `logging`: Return `[value, logs]` with a repair log.
- `strict`: Disable lenient repair behavior and require stricter parsing.
- `indent`: Pretty-print string output with a numeric or string indent.
- `ensureAscii`: Escape non-ASCII characters in string output.
- `skipJsonParse`: Skip the fast `JSON.parse()` path and always run the repair parser.
- `schema`: Apply JSON Schema-guided repair.
- `schemaRepairMode`: Use `"standard"` or `"salvage"` schema repair.
- `chunkLength`: Read large files in chunks when using `load()` or `fromFile()`.
- `streamStable`: Keep parser behavior stable for chunked/stream-like inputs.

## CLI

Run the bundled binary with a file path or pipe JSON through stdin:

```bash
pnpx ai-json-repair broken.json
pnpx ai-json-repair broken.json --indent 2
cat broken.json | pnpx ai-json-repair
```

By default the CLI reads a file or stdin and writes repaired JSON to stdout. Use `--output` to write somewhere else, or `--inline` to update the input file in place:

```bash
pnpx ai-json-repair broken.json --output fixed.json
pnpx ai-json-repair broken.json --inline
```

Supported flags:

- `--indent <n>`
- `--ensure-ascii`
- `--skip-json-parse`
- `--strict`
- `--schema <path>`
- `--schema-module <specifier>`
- `--schema-repair-mode <standard|salvage>`
- `--inline`
- `--output <path>`

`--inline` and `--output` are mutually exclusive, and `--strict` cannot be combined with schema-based repairs.

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

Use `schemaRepairMode: "salvage"` to keep valid portions of partially bad structured data when possible:

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

If you want to load a schema from a module, use `loadSchemaModule("path/to/schema.mjs:exportName")`. Plain schema objects, exported classes, and objects with a `toJSONSchema()` method are supported.

## Files And Large Inputs

For file-based workflows, use `fromFile()` or `load()`:

```ts
import { fromFile } from "ai-json-repair";

const value = await fromFile("broken.json", { chunkLength: 64 * 1024 });
```

`chunkLength` is useful when repairing large inputs without loading the whole file into the parser at once.

## Development

```bash
pnpm install
pnpm check
pnpm test
pnpm build
```

## Releases

This repository is configured for automated releases from `main` with `semantic-release`.

Release rules:

- `fix:` publishes a patch release
- `feat:` publishes a minor release
- `BREAKING CHANGE:` or `!` publishes a major release

Examples:

```text
fix: preserve escaped quotes in strings
feat: add schema-driven salvage mode
feat!: change default CLI exit behavior
```

On each push to `main`, the release workflow will:

- compute the next version from Conventional Commits
- create a git tag like `v1.2.3`
- publish the package to npm
- create a GitHub release
