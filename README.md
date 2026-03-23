# ai-json-repair

TypeScript/JavaScript port of [mangiucugna/json_repair](https://github.com/mangiucugna/json_repair).

## Installation

```bash
npm install ai-json-repair
```

The package also ships a `json-repair` CLI binary, so after installing it you can repair files or pipe JSON through stdin.

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

When `logging: true` is enabled, the repair functions return a tuple of the repaired parsed value and the repair log:

```ts
import { jsonRepair } from "ai-json-repair";

const [repairedValue, logs] = jsonRepair(`{"name": "Ada"`, { logging: true });
// repairedValue: { name: "Ada" }
// logs: [{ context: "...", text: "..." }, ...]
```

## API

```ts
jsonRepair(input: string, options?)
jsonRepair.parse(input: string, options?)
loads(input: string, options?)
load(fileOrHandle, options?)
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

## CLI

Install the package normally, then run the bundled binary:

```bash
pnpm add ai-json-repair
npx json-repair broken.json
```

By default the CLI reads a file or stdin and writes repaired JSON to stdout. Use `--output` to write to a different file, or `--inline` to update the input file in place:

```bash
npx json-repair broken.json --indent 2
npx json-repair broken.json --output fixed.json
cat broken.json | npx json-repair
```

Supported CLI flags mirror the packaged parser surface that the binary exposes:

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

### npm Trusted Publishing

The workflow is set up for npm trusted publishing with GitHub Actions OIDC. To enable it on npm:

1. Open the `ai-json-repair` package settings on npm.
2. Add a trusted publisher for `kevin51jiang/ai-json-repair`.
3. Select the workflow file `.github/workflows/release.yml`.

No `NPM_TOKEN` secret is required once trusted publishing is enabled.

If npm requires the package to exist before a trusted publisher can be attached, publish `ai-json-repair` once manually to claim the name, then switch over to the OIDC workflow.
