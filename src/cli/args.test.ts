import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  buildSpecs,
  parseArgs,
  kebabToCamel,
  camelToKebab,
  formatHelp,
} from "./args.js";
import type { Tool } from "../tools/registry.js";

// A schema exercising every kind the CLI must handle: required string,
// optional string, number-with-default, optional enum, and boolean.
const schema = {
  groupUrlName: z.string().describe("group url"),
  title: z.string().optional().describe("title"),
  duration: z.number().optional().describe("minutes"),
  platform: z.enum(["meetup", "luma"]).optional().describe("platform"),
  publish: z.boolean().optional().describe("publish now"),
};

describe("name conversion", () => {
  it("round-trips kebab and camel", () => {
    expect(kebabToCamel("group-url-name")).toBe("groupUrlName");
    expect(camelToKebab("groupUrlName")).toBe("group-url-name");
  });
});

describe("buildSpecs", () => {
  it("derives kind, required, and choices from the zod schema", () => {
    const specs = buildSpecs(schema);
    const byKey = Object.fromEntries(specs.map((s) => [s.key, s]));

    expect(byKey.groupUrlName).toMatchObject({ kind: "string", required: true, flag: "group-url-name" });
    expect(byKey.title).toMatchObject({ kind: "string", required: false });
    expect(byKey.duration).toMatchObject({ kind: "number", required: false });
    expect(byKey.platform).toMatchObject({ kind: "enum", required: false, choices: ["meetup", "luma"] });
    expect(byKey.publish).toMatchObject({ kind: "boolean", required: false });
  });
});

describe("parseArgs", () => {
  it("parses kebab flags, coerces numbers, and accepts bare booleans", () => {
    const r = parseArgs(schema, [
      "--group-url-name", "ai-night",
      "--duration", "90",
      "--platform", "luma",
      "--publish",
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({ groupUrlName: "ai-night", duration: 90, platform: "luma", publish: true });
    }
  });

  it("accepts --flag=value and camelCase spellings", () => {
    const r = parseArgs(schema, ["--groupUrlName=ai-night", "--title=Hello"]);
    expect(r.ok && r.value).toMatchObject({ groupUrlName: "ai-night", title: "Hello" });
  });

  it("negates booleans with --no-flag and =false", () => {
    expect(parseArgs(schema, ["--group-url-name", "x", "--no-publish"]).ok && parseArgs(schema, ["--group-url-name", "x", "--no-publish"]))
      .toMatchObject({ value: { publish: false } });
    expect(parseArgs(schema, ["--group-url-name", "x", "--publish=false"]))
      .toMatchObject({ value: { publish: false } });
  });

  it("rejects unknown flags", () => {
    const r = parseArgs(schema, ["--group-url-name", "x", "--bogus", "y"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Unknown flag: --bogus");
  });

  it("rejects a non-numeric value for a number flag", () => {
    const r = parseArgs(schema, ["--group-url-name", "x", "--duration", "soon"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("expects a number");
  });

  it("rejects an out-of-set enum value via the zod schema", () => {
    const r = parseArgs(schema, ["--group-url-name", "x", "--platform", "facebook"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("--platform");
  });

  it("reports a missing required field through zod validation", () => {
    const r = parseArgs(schema, ["--title", "Hello"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("--group-url-name");
  });

  it("errors when a value-flag is given no value", () => {
    const r = parseArgs(schema, ["--group-url-name"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("expects a value");
  });

  it("errors on a bare positional argument", () => {
    const r = parseArgs(schema, ["oops"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Unexpected argument");
  });
});

describe("formatHelp", () => {
  it("lists flags with type, requiredness, and choices", () => {
    const tool: Tool = {
      name: "demo_command",
      description: "Demo command.",
      schema,
      handler: async () => "",
    };
    const help = formatHelp(tool);
    expect(help).toContain("events demo-command");
    expect(help).toContain("--group-url-name");
    expect(help).toContain("[required]");
    expect(help).toContain("(meetup|luma)");
  });

  it("notes when a command takes no flags", () => {
    const tool: Tool = {
      name: "luma_list_events",
      description: "List.",
      schema: {},
      handler: async () => "",
    };
    expect(formatHelp(tool)).toContain("(no flags)");
  });
});
