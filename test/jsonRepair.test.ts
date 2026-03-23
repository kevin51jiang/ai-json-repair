import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { fromFile, jsonRepair, loads } from "../src/index";

type RepairLog = { text: string; context: string };

function repairText(input: string, options: Record<string, unknown> = {}): string {
  return jsonRepair(input, options) as string;
}

function repairValue<T>(input: string, options: Record<string, unknown> = {}): T {
  return jsonRepair(input, { ...options, returnObjects: true }) as T;
}

describe("jsonRepair core", () => {
  it("preserves valid JSON and normalizes spacing", () => {
    expect(repairText('{"name":"John","age":30,"city":"New York"}')).toBe(
      '{"name": "John", "age": 30, "city": "New York"}',
    );
    expect(repairText('{"employees":["John","Anna","Peter"]} ')).toBe('{"employees": ["John", "Anna", "Peter"]}');
    expect(repairText('{"key":"value:value"}')).toBe('{"key": "value:value"}');
    expect(repairText('{"text":"The quick brown fox,"}')).toBe('{"text": "The quick brown fox,"}');
    expect(repairText('{"text":"The quick brown fox won\'t jump"}')).toBe(
      '{"text": "The quick brown fox won\'t jump"}',
    );
    expect(repairText('{"key": ""')).toBe('{"key": ""}');
    expect(repairText('{"key1": {"key2": [1, 2, 3]}}')).toBe('{"key1": {"key2": [1, 2, 3]}}');
    expect(repairText('{"key": 12345678901234567890}')).toBe('{"key": 12345678901234567890}');
    expect(repairText('{"key": "value\\u263a"}')).toBe('{"key": "value\\u263a"}');
    expect(repairText('{"key": "value\\nvalue"}')).toBe('{"key": "value\\nvalue"}');
    expect(repairText("{'test_中国人_ascii':'统一码'}", { ensureAscii: false })).toBe('{"test_中国人_ascii": "统一码"}');
  });

  it("returns useful parsed values through loads and returnObjects", () => {
    expect(loads("[]")).toEqual([]);
    expect(loads("{}")).toEqual({});
    expect(loads('{"key": true, "key2": false, "key3": null}')).toEqual({
      key: true,
      key2: false,
      key3: null,
    });
    expect(loads('{"name": "John", "age": 30, "city": "New York"}')).toEqual({
      name: "John",
      age: 30,
      city: "New York",
    });
    expect(loads("[1, 2, 3, 4]")).toEqual([1, 2, 3, 4]);
    expect(
      repairValue<{
        resourceType: string;
        id: string;
        type: string;
        entry: Array<{ resource: { resourceType: string; id: string; name: Array<Record<string, unknown>> } }>;
      }>(`
{
  "resourceType": "Bundle",
  "id": "1",
  "type": "collection",
  "entry": [
    {
      "resource": {
        "resourceType": "Patient",
        "id": "1",
        "name": [
          {"use": "official", "family": "Corwin", "given": ["Keisha", "Sunny"], "prefix": ["Mrs."},
          {"use": "maiden", "family": "Goodwin", "given": ["Keisha", "Sunny"], "prefix": ["Mrs."]}
        ]
      }
    }
  ]
}
`),
    ).toEqual({
      resourceType: "Bundle",
      id: "1",
      type: "collection",
      entry: [
        {
          resource: {
            resourceType: "Patient",
            id: "1",
            name: [
              {
                use: "official",
                family: "Corwin",
                given: ["Keisha", "Sunny"],
                prefix: ["Mrs."],
              },
              {
                use: "maiden",
                family: "Goodwin",
                given: ["Keisha", "Sunny"],
                prefix: ["Mrs."],
              },
            ],
          },
        },
      ],
    });
    expect(repairValue<{ html: string }>(
      '{\n"html": "<h3 id="aaa">Waarom meer dan 200 Technical Experts - "Passie voor techniek"?</h3>"}',
    )).toEqual({ html: '<h3 id="aaa">Waarom meer dan 200 Technical Experts - "Passie voor techniek"?</h3>' });
  });

  it("handles multiple top-level payloads", () => {
    expect(repairText("[]{}")).toBe("[]");
    expect(repairText('[]{"key":"value"}')).toBe('{"key": "value"}');
    expect(repairText('{"key":"value"}[1,2,3,True]')).toBe('[{"key": "value"}, [1, 2, 3, true]]');
    expect(repairText('lorem ```json {"key":"value"} ``` ipsum ```json [1,2,3,True] ``` 42')).toBe(
      '[{"key": "value"}, [1, 2, 3, true]]',
    );
    expect(repairText('[{"key":"value"}][{"key":"value_after"}]')).toBe('[{"key": "value_after"}]');
  });

  it("supports skipJsonParse as a fast path opt-out", () => {
    expect(repairText('{"key": true, "key2": false, "key3": null}', { skipJsonParse: true })).toBe(
      '{"key": true, "key2": false, "key3": null}',
    );
    expect(
      repairValue<{ key: boolean; key2: boolean; key3: null }>('{"key": true, "key2": false, "key3": null}', {
        skipJsonParse: true,
      }),
    ).toEqual({ key: true, key2: false, key3: null });
    expect(repairText('{"key": true, "key2": false, "key3": }', { skipJsonParse: true })).toBe(
      '{"key": true, "key2": false, "key3": ""}',
    );
  });

  it("parses top-level booleans and nulls", () => {
    expect(repairValue("True")).toBe("");
    expect(repairValue("False")).toBe("");
    expect(repairValue("Null")).toBe("");
    expect(repairValue("true")).toBe(true);
    expect(repairValue("false")).toBe(false);
    expect(repairValue("null")).toBe(null);
    expect(repairValue('{"key": TRUE, "key2": FALSE, "key3": Null}   ')).toEqual({
      key: true,
      key2: false,
      key3: null,
    });
  });

  it("keeps streaming output stable when requested", () => {
    expect(repairText('{"key": "val\\', { streamStable: false })).toBe('{"key": "val\\\\"}');
    expect(repairText('{"key": "val\\n', { streamStable: false })).toBe('{"key": "val"}');
    expect(repairText('{"key": "val\\n123,`key2:value2', { streamStable: false })).toBe(
      '{"key": "val\\n123", "key2": "value2"}',
    );
    expect(repairText('{"key": "val\\n123,`key2:value2`"}', { streamStable: true })).toBe(
      '{"key": "val\\n123,`key2:value2`"}',
    );
    expect(repairText('{"key": "val\\', { streamStable: true })).toBe('{"key": "val"}');
    expect(repairText('{"key": "val\\n', { streamStable: true })).toBe('{"key": "val\\n"}');
    expect(repairText('{"key": "val\\n123,`key2:value2', { streamStable: true })).toBe(
      '{"key": "val\\n123,`key2:value2"}',
    );
    expect(repairText('{"key": "val\\n123,`key2:value2`"}', { streamStable: true })).toBe(
      '{"key": "val\\n123,`key2:value2`"}',
    );
  });

  it("returns repair logs when logging is enabled", () => {
    const [repaired, logs] = jsonRepair('{"key": "value}', { logging: true }) as [
      { key: string },
      RepairLog[],
    ];

    expect(repaired).toEqual({ key: "value" });
    expect(logs).toEqual([
      {
        context: 'y": "value}',
        text: "While parsing a string missing the left delimiter in object value context, we found a , or } and we couldn't determine that a right delimiter was present. Stopping here",
      },
      {
        context: 'y": "value}',
        text: "While parsing a string, we missed the closing quote, ignoring",
      },
    ]);
  });

  it("returns parsed values when logging is enabled on the native fast path", () => {
    expect(jsonRepair("{}", { logging: true })).toEqual([{}, []]);
    expect(jsonRepair('{"value": "1"}', { schema: { type: "object", properties: { value: { type: "integer" } }, required: ["value"] }, logging: true } as never)).toEqual([
      { value: 1 },
      [],
    ]);
    expect(jsonRepair('{"key": "value", "items": ["alpha", "beta"]}', { logging: true, returnObjects: true })).toEqual([
      { key: "value", items: ["alpha", "beta"] },
      [],
    ]);
  });
});

describe("jsonRepair strict mode", () => {
  it("rejects multiple top-level values", () => {
    expect(() => jsonRepair('{"key":"value"}["value"]', { strict: true })).toThrow(
      "Multiple top-level JSON elements",
    );
  });

  it("rejects duplicate keys inside arrays", () => {
    expect(() => jsonRepair('[{"key": "first", "key": "second"}]', { strict: true, skipJsonParse: true })).toThrow(
      "Duplicate key found",
    );
  });

  it("rejects empty keys", () => {
    expect(() => jsonRepair('{"" : "value"}', { strict: true, skipJsonParse: true })).toThrow("Empty key found");
  });

  it("rejects missing colons", () => {
    expect(() => jsonRepair('{"missing" "colon"}', { strict: true })).toThrow("Missing ':' after key");
  });

  it("rejects empty values", () => {
    expect(() => jsonRepair('{"key": , "key2": "value2"}', { strict: true, skipJsonParse: true })).toThrow(
      "Parsed value is empty",
    );
  });

  it("rejects empty objects with extra characters", () => {
    expect(() => jsonRepair('{"dangling"}', { strict: true })).toThrow("Parsed object is empty");
  });

  it("rejects doubled quotes", () => {
    expect(() => jsonRepair('{"key": """"}', { strict: true })).toThrow(/doubled quotes followed by another quote\.$/);
    expect(() => jsonRepair('{"key": "" "value"}', { strict: true })).toThrow(
      "doubled quotes followed by another quote while parsing a string",
    );
  });
});

describe("jsonRepair primitives", () => {
  it("repairs numbers", () => {
    expect(loads("1")).toBe(1);
    expect(loads("1.2")).toBe(1.2);
    expect(loads('{"value": 82_461_110}')).toEqual({ value: 82461110 });
    expect(loads('{"value": 1_234.5_6}')).toEqual({ value: 1234.56 });
    expect(repairText(' - { "test_key": ["test_value", "test_value2"] }')).toBe(
      '{"test_key": ["test_value", "test_value2"]}',
    );
    expect(repairText('{"key": 1/3}')).toBe('{"key": "1/3"}');
    expect(repairText('{"key": .25}')).toBe('{"key": 0.25}');
    expect(repairText('{"here": "now", "key": 1/3, "foo": "bar"}')).toBe(
      '{"here": "now", "key": "1/3", "foo": "bar"}',
    );
    expect(repairText('{"key": 12345/67890}')).toBe('{"key": "12345/67890"}');
    expect(repairText("[105,12")).toBe("[105, 12]");
    expect(repairText('{"key", 105,12,')).toBe('{"key": "105,12"}');
    expect(repairText('{"key": 1/3, "foo": "bar"}')).toBe('{"key": "1/3", "foo": "bar"}');
    expect(repairText('{"key": 10-20}')).toBe('{"key": "10-20"}');
    expect(repairText('{"key": 1.1.1}')).toBe('{"key": "1.1.1"}');
    expect(repairText("[- ")).toBe("[]");
    expect(repairText('{"key": 1. }')).toBe('{"key": 1.0}');
    expect(repairText('{"key": 1e10 }')).toBe('{"key": 10000000000.0}');
    expect(repairText('{"key": 1e }')).toBe('{"key": 1}');
    expect(repairText('{"key": 1notanumber }')).toBe('{"key": "1notanumber"}');
    expect(repairText('{"rowId": 57eeeeb1-450b-482c-81b9-4be77e95dee2}')).toBe(
      '{"rowId": "57eeeeb1-450b-482c-81b9-4be77e95dee2"}',
    );
    expect(repairText("[1, 2notanumber]")).toBe('[1, "2notanumber"]');
  });

  it("repairs comments and wrappers", () => {
    expect(repairText("/")).toBe("");
    expect(repairText('/* comment */ {"key": "value"}')).toBe('{"key": "value"}');
    expect(repairText('{ "key": { "key2": "value2" // comment }, "key3": "value3" }')).toBe(
      '{"key": {"key2": "value2"}, "key3": "value3"}',
    );
    expect(repairText('{ "key": { "key2": "value2" # comment }, "key3": "value3" }')).toBe(
      '{"key": {"key2": "value2"}, "key3": "value3"}',
    );
    expect(repairText('{ "key": { "key2": "value2" /* comment */ }, "key3": "value3" }')).toBe(
      '{"key": {"key2": "value2"}, "key3": "value3"}',
    );
    expect(repairText('[ "value", /* comment */ "value2" ]')).toBe('["value", "value2"]');
    expect(repairText('{ "key": "value" /* comment')).toBe('{"key": "value"}');
  });

  it("repairs strings and missing quotes", () => {
    expect(repairText('"')).toBe("");
    expect(repairText("\n")).toBe("");
    expect(repairText(" ")).toBe("");
    expect(repairText("string")).toBe("");
    expect(repairText("stringbeforeobject {}")).toBe("{}");
    expect(repairText("{'key': 'string', 'key2': false, \"key3\": null, \"key4\": unquoted}")).toBe(
      '{"key": "string", "key2": false, "key3": null, "key4": "unquoted"}',
    );
    expect(repairText('{"name": "John", "age": 30, "city": "New York')).toBe(
      '{"name": "John", "age": 30, "city": "New York"}',
    );
    expect(repairText('{"name": "John", "age": 30, city: "New York"}')).toBe(
      '{"name": "John", "age": 30, "city": "New York"}',
    );
    expect(repairText('{"name": "John", "age": 30, "city": New York}')).toBe(
      '{"name": "John", "age": 30, "city": "New York"}',
    );
    expect(repairText('{"name": John, "age": 30, "city": "New York"}')).toBe(
      '{"name": "John", "age": 30, "city": "New York"}',
    );
    expect(repairText('{“slanted_delimiter”: "value"}')).toBe('{"slanted_delimiter": "value"}');
    expect(repairText('{"name": "John", "age": 30, "city": "New')).toBe(
      '{"name": "John", "age": 30, "city": "New"}',
    );
    expect(repairText('{"name": "John", "age": 30, "city": "New York, "gender": "male"}')).toBe(
      '{"name": "John", "age": 30, "city": "New York", "gender": "male"}',
    );
    expect(repairText('[{"key": "value", COMMENT "notes": "lorem "ipsum", sic." }]')).toBe(
      '[{"key": "value", "notes": "lorem \\"ipsum\\", sic."}]',
    );
    expect(repairText('{"key": ""value"}')).toBe('{"key": "value"}');
    expect(repairText('{"foo": "\\"bar\\""')).toBe('{"foo": "\\"bar\\""}');
    expect(repairText('{"" key":"val"')).toBe('{" key": "val"}');
    expect(repairValue('{"key": "value", 5: "value"}')).toEqual({ key: "value", 5: "value" });
    expect(repairText('{"key": "v"alue"}')).toBe('{"key": "v\\"alue\\""}');
    expect(repairText('{"key": value "key2" : "value2" ')).toBe('{"key": "value", "key2": "value2"}');
    expect(repairText('{"key": "lorem ipsum ... "sic " tamet. ...}')).toBe(
      '{"key": "lorem ipsum ... \\"sic \\" tamet. ..."}',
    );
    expect(repairText('{"key": value , }')).toBe('{"key": "value"}');
    expect(repairText('{"comment": "lorem, "ipsum" sic "tamet". To improve"}')).toBe(
      '{"comment": "lorem, \\"ipsum\\" sic \\"tamet\\". To improve"}',
    );
    expect(repairText('{"key": "v"alu"e"} key:')).toBe('{"key": "v\\"alu\\"e"}');
    expect(repairText('{"key": "v"alue", "key2": "value2"}')).toBe('{"key": "v\\"alue", "key2": "value2"}');
    expect(repairText('[{"key": "v"alu,e", "key2": "value2"}]')).toBe('[{"key": "v\\"alu,e", "key2": "value2"}]');
    expect(repairText("'\"'")).toBe("");
    expect(repairText('{"key": \'string"\n\t\\le\'}')).toBe('{"key": "string\\"\\n\\t\\\\le"}');
    expect(
      repairText(
        '{"real_content": "Some string: Some other string \\t Some string <a href=\\"https://domain.com\\">Some link</a>"',
      ),
    ).toBe(
      '{"real_content": "Some string: Some other string \\t Some string <a href=\\"https://domain.com\\">Some link</a>"}',
    );
    expect(repairText('{"key_1\n": "value"}')).toBe('{"key_1": "value"}');
    expect(repairText('{"key\t_": "value"}')).toBe('{"key\\t_": "value"}');
    expect(repairText("{\"key\": '\u0076\u0061\u006c\u0075\u0065'}")).toBe('{"key": "value"}');
    expect(repairText('{"key": "\\u0076\\u0061\\u006C\\u0075\\u0065"}', { skipJsonParse: true })).toBe(
      '{"key": "value"}',
    );
    expect(repairText(`{"key": "valu\\'e"}`)).toBe(`{"key": "valu'e"}`);
    expect(repairText('{\'key\': "{\\"key\\": 1, \\"key2\\": 1}"}')).toBe(
      '{"key": "{\\"key\\": 1, \\"key2\\": 1}"}',
    );
    expect(repairText("{'': 1}")).toBe('{"": 1}');
  });

  it("handles markdown and fenced JSON blocks", () => {
    expect(repairText('{ "content": "[LINK]("https://google.com")" }')).toBe(
      '{"content": "[LINK](\\"https://google.com\\")"}',
    );
    expect(repairText('{ "content": "[LINK](" }')).toBe('{"content": "[LINK]("}');
    expect(repairText('{ "content": "[LINK](", "key": true }')).toBe('{"content": "[LINK](", "key": true}');
    expect(repairText('````{ "key": "value" }```')).toBe('{"key": "value"}');
    expect(repairText('"{    "a": "",    "b": [ { "c": 1} ] \n}```')).toBe('{"a": "", "b": [{"c": 1}]}');
    expect(repairText("Based on the information extracted, here is the filled JSON output: ```json { 'a': 'b' } ```")).toBe(
      '{"a": "b"}',
    );
    expect(
      repairText(`
                       The next 64 elements are:
                       \`\`\`json
                       { "key": "value" }
                       \`\`\`
      `),
    ).toBe('{"key": "value"}');
    expect(repairText('{"key": "``"')).toBe('{"key": "``"}');
    expect(repairText('{"key": "```json"')).toBe('{"key": "```json"}');
    expect(repairText('{"key": "```json {"key": [{"key1": 1},{"key2": 2}]}```"}')).toBe(
      '{"key": {"key": [{"key1": 1}, {"key2": 2}]}}',
    );
    expect(repairText('{"response": "```json{}"')).toBe('{"response": "```json{}"}');
  });

  it("logs invalid code fences while still repairing the surrounding string", () => {
    const [repaired, logs] = jsonRepair('{"key": "```json nope\\n"}', {
      skipJsonParse: true,
      returnObjects: true,
      logging: true,
    }) as [{ key: string }, RepairLog[]];

    expect(repaired).toEqual({ key: "```json nope" });
    expect(logs.some((entry) => entry.text.includes("did not enclose valid JSON"))).toBe(true);
  });

  it("handles arrays and object-array crossover", () => {
    expect(loads("[]")).toEqual([]);
    expect(loads("[1, 2, 3, 4]")).toEqual([1, 2, 3, 4]);
    expect(loads("[")).toEqual([]);
    expect(repairText("[[1\n\n]")).toBe("[[1]]");
    expect(repairText("[{]")).toBe("[]");
    expect(repairText("[")).toBe("[]");
    expect(repairText('["')).toBe("[]");
    expect(repairText("[1, 2, 3,")).toBe("[1, 2, 3]");
    expect(repairText("]")).toBe("");
    expect(repairText("[1, 2, 3, ...]")).toBe("[1, 2, 3]");
    expect(repairText("[1, 2, ... , 3]")).toBe("[1, 2, 3]");
    expect(repairText("[1, 2, '...', 3]")).toBe('[1, 2, "...", 3]');
    expect(repairText("[true, false, null, ...]")).toBe("[true, false, null]");
    expect(repairText('["a" "b" "c" 1')).toBe('["a", "b", "c", 1]');
    expect(repairText('{"employees":["John", "Anna",')).toBe('{"employees": ["John", "Anna"]}');
    expect(repairText('{"employees":["John", "Anna", "Peter')).toBe('{"employees": ["John", "Anna", "Peter"]}');
    expect(repairText('{"key1": {"key2": [1, 2, 3')).toBe('{"key1": {"key2": [1, 2, 3]}}');
    expect(repairText('{"key": ["value]}')).toBe('{"key": ["value"]}');
    expect(repairText('["lorem "ipsum" sic"]')).toBe('["lorem \\"ipsum\\" sic"]');
    expect(repairText('{"key1": ["value1", "value2"}, "key2": ["value3", "value4"]}')).toBe(
      '{"key1": ["value1", "value2"], "key2": ["value3", "value4"]}',
    );
    expect(
      repairText(
        '{"headers": ["A", "B", "C"], "rows": [["r1a", "r1b", "r1c"], ["r2a", "r2b", "r2c"], "r3a", "r3b", "r3c"], ["r4a", "r4b", "r4c"], ["r5a", "r5b", "r5c"]]}',
      ),
    ).toBe(
      '{"headers": ["A", "B", "C"], "rows": [["r1a", "r1b", "r1c"], ["r2a", "r2b", "r2c"], ["r3a", "r3b", "r3c"], ["r4a", "r4b", "r4c"], ["r5a", "r5b", "r5c"]]}',
    );
    expect(repairText('{"key": ["value" "value1" "value2"]}')).toBe('{"key": ["value", "value1", "value2"]}');
    expect(repairText('{"key": ["lorem "ipsum" dolor "sit" amet, "consectetur" ", "lorem "ipsum" dolor", "lorem"]}')).toBe(
      '{"key": ["lorem \\"ipsum\\" dolor \\"sit\\" amet, \\"consectetur\\" ", "lorem \\"ipsum\\" dolor", "lorem"]}',
    );
    expect(repairText('{"k"e"y": "value"}')).toBe('{"k\\"e\\"y": "value"}');
    expect(repairText('["key":"value"}]')).toBe('[{"key": "value"}]');
    expect(repairText('["key":"value"]')).toBe('[{"key": "value"}]');
    expect(repairText('[ "key":"value"]')).toBe('[{"key": "value"}]');
    expect(repairText('[{"key": "value", "key')).toBe('[{"key": "value"}, ["key"]]');
    expect(repairText("{'key1', 'key2'}")).toBe('["key1", "key2"]');
    expect(repairText('["value1" value2", "value3"]')).toBe('["value1", "value2", "value3"]');
    expect(
      repairText('{"bad_one":["Lorem Ipsum", "consectetur" comment" ], "good_one":[ "elit", "sed", "tempor"]}'),
    ).toBe('{"bad_one": ["Lorem Ipsum", "consectetur", "comment"], "good_one": ["elit", "sed", "tempor"]}');
    expect(
      repairText('{"bad_one": ["Lorem Ipsum","consectetur" comment],"good_one": ["elit","sed","tempor"]}'),
    ).toBe('{"bad_one": ["Lorem Ipsum", "consectetur", "comment"], "good_one": ["elit", "sed", "tempor"]}');
  });

  it("repairs object boundaries and separators", () => {
    expect(repairText("{}")).toBe("{}");
    expect(repairValue("{}")).toEqual({});
    expect(repairText("{")).toBe("{}");
    expect(repairText("}")).toBe("");
    expect(repairText('{"')).toBe("{}");
    expect(repairValue('{ "key": value, "key2": 1 "key3": null }')).toEqual({
      key: "value",
      key2: 1,
      key3: null,
    });
    expect(repairText('{foo: [}')).toBe('{"foo": []}');
    expect(repairText('{"": "value"')).toBe('{"": "value"}');
    expect(repairText('{"key": "value"}, "key2": "value2"}')).toBe('{"key": "value", "key2": "value2"}');
    expect(repairText('{"key": "value"}, []')).toBe('{"key": "value"}');
    expect(repairText('{"key": "value"}, ["abc"]')).toBe('[{"key": "value"}, ["abc"]]');
    expect(repairText('{"key": "value"}, {}')).toBe('{"key": "value"}');
    expect(repairText('{"key": "value"}, "key2": "value2"}')).toBe('{"key": "value", "key2": "value2"}');
    expect(repairText('{"key": "value"}, "key2": }')).toBe('{"key": "value", "key2": ""}');
    expect(repairText('{"key": "value"}, "" : "value2"}')).toBe('{"key": "value", "": "value2"}');
    expect(repairText('{"key1": "value1"}, "key2": "value2", "key3": "value3"}')).toBe(
      '{"key1": "value1", "key2": "value2", "key3": "value3"}',
    );
    expect(repairText('{key:value,key2:value2}')).toBe('{"key": "value", "key2": "value2"}');
    expect(repairText('{"key:"value"}')).toBe('{"key": "value"}');
    expect(repairText('{"key:value}')).toBe('{"key": "value"}');
    expect(repairText('{"key": , "key2": "value2"}')).toBe('{"key": "", "key2": "value2"}');
    expect(repairText('{"array":[{"key": "value"], "key2": "value2"}')).toBe(
      '{"array": [{"key": "value"}], "key2": "value2"}',
    );
    expect(repairText('[{"key":"value"}},{"key":"value"}]')).toBe('[{"key": "value"}, {"key": "value"}]');
    expect(
      repairText("{'key': ['a':{'duplicated_key': 'duplicated_value', 'duplicated_key': 'duplicated_value'}]}"),
    ).toBe('{"key": [{"a": {"duplicated_key": "duplicated_value"}}]}');
    expect(repairValue('[{"b":"v2","b":"v2"}]', { skipJsonParse: true })).toEqual([{ b: "v2" }]);
  });
});

describe("file helpers", () => {
  it("loads from a file path", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "json-repair-test-"));
    const filePath = join(tempDir, "payload.json");
    writeFileSync(filePath, '{"name":"John","age":30}\n');

    await expect(fromFile(filePath)).resolves.toEqual({ name: "John", age: 30 });
  });
});
