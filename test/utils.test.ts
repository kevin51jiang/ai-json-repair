import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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

  it("keeps fixture-driven large-file repair available", async () => {
    const valid = readFileSync("test/fixtures/valid.json", "utf8");
    expect(await fromFile("test/fixtures/valid.json")).toEqual(JSON.parse(valid));

    const repaired = await fromFile("test/fixtures/invalid.json", { logging: true });
    expect(repaired).toEqual([expect.any(Array), expect.any(Array)]);
  });
});
