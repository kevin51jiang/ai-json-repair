import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { cli } from "../src/index";

function createIO(input = "") {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stderr: { write: (text: string) => stderr.push(text) },
      stdin: { text: input },
      stdout: { write: (text: string) => stdout.push(text) },
    },
    stderr,
    stdout,
  };
}

describe("cli parity", () => {
  it("supports filename input, stdout output, and indent control", async () => {
    const dir = mkdtempSync(join(tmpdir(), "json-repair-cli-"));
    const inputPath = join(dir, "input.json");
    const schemaPath = join(dir, "schema.json");
    writeFileSync(inputPath, '{"value":"1"}', "utf8");
    writeFileSync(schemaPath, JSON.stringify({ type: "object", properties: { value: { type: "integer" } }, required: ["value"] }), "utf8");

    const { io, stdout, stderr } = createIO();
    const exitCode = await cli([inputPath, "--indent", "2", "--schema", schemaPath], io);

    expect(exitCode).toBe(0);
    expect(stderr.join("")).toBe("");
    expect(stdout.join("")).toContain('"value": 1');
  });

  it("supports inline replacement and output redirection", async () => {
    const dir = mkdtempSync(join(tmpdir(), "json-repair-cli-"));
    const inputPath = join(dir, "input.json");
    const outputPath = join(dir, "output.json");
    writeFileSync(inputPath, "{key:value}", "utf8");

    let result = await cli([inputPath, "--output", outputPath], createIO().io);
    expect(result).toBe(0);
    expect(readFileSync(outputPath, "utf8")).toBe('{"key": "value"}');

    result = await cli([inputPath, "--inline"], createIO().io);
    expect(result).toBe(0);
    expect(readFileSync(inputPath, "utf8")).toBe('{"key": "value"}');
  });

  it("rejects invalid flag combinations", async () => {
    let capture = createIO();
    let result = await cli(["--inline"], capture.io);
    expect(result).toBe(1);
    expect(capture.stderr.join("")).toContain("Inline mode requires a filename");

    capture = createIO();
    result = await cli(["file.json", "--inline", "--output", "out.json"], capture.io);
    expect(result).toBe(1);
    expect(capture.stderr.join("")).toContain("both --inline and --output");

    capture = createIO();
    result = await cli(["--schema-repair-mode", "salvage"], capture.io);
    expect(result).toBe(1);
    expect(capture.stderr.join("")).toContain("requires --schema");
  });
});
