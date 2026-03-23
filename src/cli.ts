import { readFile, writeFile } from "node:fs/promises";

import { jsonRepair } from "./jsonRepair";
import { loadSchemaModule, schemaFromInput } from "./schema/schemaRepair";
import type { JsonRepairOptions, JsonSchema } from "./types";

export interface CliIO {
  stderr: { write: (text: string) => void };
  stdin: { read?: () => Promise<string>; text?: string };
  stdout: { write: (text: string) => void };
}

interface ParsedArgs {
  ensureAscii: boolean;
  filename?: string;
  indent?: number;
  inline: boolean;
  output?: string;
  schemaModule?: string;
  schemaPath?: string;
  schemaRepairMode?: string;
  skipJsonParse: boolean;
  strict: boolean;
}

export async function cli(inlineArgs: string[] = [], io: CliIO = defaultIO()): Promise<number> {
  const args = parseArgs(inlineArgs);
  if (args.inline && !args.filename) {
    io.stderr.write("Error: Inline mode requires a filename\n");
    return 1;
  }
  if (args.inline && args.output) {
    io.stderr.write("Error: You cannot pass both --inline and --output\n");
    return 1;
  }
  if (args.strict && args.schemaPath) {
    io.stderr.write("Error: --strict cannot be used with --schema\n");
    return 1;
  }
  if (args.strict && args.schemaModule) {
    io.stderr.write("Error: --strict cannot be used with --schema-module\n");
    return 1;
  }
  if (args.schemaPath && args.schemaModule) {
    io.stderr.write("Error: You cannot pass both --schema and --schema-module\n");
    return 1;
  }
  if (args.schemaRepairMode === "salvage" && !args.schemaPath) {
    if (!args.schemaModule) {
      io.stderr.write("Error: --schema-repair-mode salvage requires --schema or --schema-module\n");
      return 1;
    }
  }

  let schema: JsonSchema | undefined;
  if (args.schemaPath) {
    schema = schemaFromInput(JSON.parse(await readFile(args.schemaPath, "utf8")) as unknown);
  } else if (args.schemaModule) {
    schema = await loadSchemaModule(args.schemaModule);
  }
  const options: JsonRepairOptions = {
    ensureAscii: args.ensureAscii,
    indent: args.indent,
    schema,
    schemaRepairMode: args.schemaRepairMode as JsonRepairOptions["schemaRepairMode"],
    skipJsonParse: args.skipJsonParse,
    strict: args.strict,
  };

  const input = args.filename ? await readFile(args.filename, "utf8") : await readStdin(io.stdin);
  const output = jsonRepair(input, options) as string;

  if (args.output) {
    await writeFile(args.output, output, "utf8");
  } else if (args.inline && args.filename) {
    await writeFile(args.filename, output, "utf8");
  } else {
    io.stdout.write(`${output}\n`);
  }
  return 0;
}

function defaultIO(): CliIO {
  return {
    stderr: process.stderr,
    stdin: {},
    stdout: process.stdout,
  };
}

async function readStdin(stdin: CliIO["stdin"]): Promise<string> {
  if (typeof stdin.read === "function") {
    return stdin.read();
  }
  if (typeof stdin.text === "string") {
    return stdin.text;
  }
  return new Promise<string>((resolve, reject) => {
    const chunks: string[] = [];
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => chunks.push(String(chunk)));
    process.stdin.on("end", () => resolve(chunks.join("")));
    process.stdin.on("error", reject);
  });
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    ensureAscii: false,
    inline: false,
    skipJsonParse: false,
    strict: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith("-") && !parsed.filename) {
      parsed.filename = arg;
      continue;
    }
    if (arg === "-i" || arg === "--inline") {
      parsed.inline = true;
      continue;
    }
    if (arg === "-o" || arg === "--output") {
      parsed.output = argv[++index];
      continue;
    }
    if (arg === "--ensure-ascii" || arg === "--ensure_ascii") {
      parsed.ensureAscii = true;
      continue;
    }
    if (arg === "--indent") {
      parsed.indent = Number(argv[++index] ?? "2");
      continue;
    }
    if (arg === "--skip-json-loads" || arg === "--skip-json-parse") {
      parsed.skipJsonParse = true;
      continue;
    }
    if (arg === "--strict") {
      parsed.strict = true;
      continue;
    }
    if (arg === "--schema") {
      parsed.schemaPath = argv[++index];
      continue;
    }
    if (arg === "--schema-module") {
      parsed.schemaModule = argv[++index];
      continue;
    }
    if (arg === "--schema-repair-mode") {
      parsed.schemaRepairMode = argv[++index];
    }
  }

  return parsed;
}
