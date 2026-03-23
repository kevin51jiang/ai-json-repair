import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { StringFileWrapper, fromFile, matchPatternProperties } from "../src/index";

describe("utility parity", () => {
  it("matches patternProperties using the safe subset of anchors", async () => {
    const [matched, unsupported] = matchPatternProperties(
      {
        "^abc$": { name: "exact" },
        bc: { name: "contains" },
        "^x[0-9]+$": { name: "unsupported" },
      },
      "abc",
    );

    expect(matched).toEqual([{ name: "exact" }, { name: "contains" }]);
    expect(unsupported).toEqual(["^x[0-9]+$"]);
  });

  it("supports chunked string/file wrapper semantics for multibyte text", async () => {
    const wrapper = new StringFileWrapper("\u0800abcd", 2);
    expect(wrapper.get({ start: 0, stop: 1 })).toBe("\u0800");
    expect(wrapper.get(0)).toBe("\u0800");
    expect(wrapper.get(-1)).toBe("d");
    expect(wrapper.get({ start: -2, stop: 5 })).toBe("cd");
    expect(wrapper.get({ start: 0, stop: 5, step: 2 })).toBe("\u0800bd");
  });

  it("covers string wrapper error paths and boundary behavior", async () => {
    const wrapper = new StringFileWrapper("abcd", 2);

    expect(() => wrapper.getBuffer(-1)).toThrow("Negative indexing is not supported");
    wrapper.size();
    expect(() => wrapper.getBuffer(2)).toThrow("Chunk index out of range");
    expect(() => wrapper.get(-10)).toThrow("string index out of range");
    expect(() => wrapper.get({ start: 0, stop: 4, step: 0 })).toThrow("slice step cannot be zero");
    expect(() => wrapper.ensureChunkPosition(10)).toThrow("Chunk index out of range");
  });

  it("keeps fixture-driven large-file repair available", async () => {
    const valid = readFileSync("test/fixtures/valid.json", "utf8");
    expect(await fromFile("test/fixtures/valid.json")).toEqual(JSON.parse(valid));

    const repaired = await fromFile("test/fixtures/invalid.json", { logging: true });
    expect(repaired).toEqual([expect.any(Array), expect.any(Array)]);
  });

  it("threads chunkLength through fromFile parsing and logging", async () => {
    const dir = mkdtempSync(join(tmpdir(), "json-repair-file-"));
    const inputPath = join(dir, "input.json");
    writeFileSync(inputPath, "{key:value}", "utf8");

    await expect(fromFile(inputPath, { chunkLength: 2 })).resolves.toEqual({ key: "value" });
    await expect(fromFile(inputPath, { chunkLength: 2, logging: true })).resolves.toEqual([
      { key: "value" },
      [
        {
          text: "While parsing a string, we found a literal instead of a quote",
          context: "{key:value}",
        },
        {
          context: "{key:value}",
          text: "While parsing a string missing the left delimiter in object key context, we found a :, stopping here",
        },
        {
          text: "While parsing a string, we missed the closing quote, ignoring",
          context: "{key:value}",
        },
        {
          text: "While parsing a string, we found a literal instead of a quote",
          context: "{key:value}",
        },
        {
          context: "{key:value}",
          text: "While parsing a string missing the left delimiter in object value context, we found a , or } and we couldn't determine that a right delimiter was present. Stopping here",
        },
        {
          text: "While parsing a string, we missed the closing quote, ignoring",
          context: "{key:value}",
        },
      ],
    ]);
  });

  it("returns an empty parsed value plus logs for large invalid files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "json-repair-file-"));
    const inputPath = join(dir, "large.txt");
    writeFileSync(inputPath, "x".repeat(5 * 1024 * 1024), "utf8");

    await expect(fromFile(inputPath, { logging: true })).resolves.toEqual(["", []]);
  });
});
