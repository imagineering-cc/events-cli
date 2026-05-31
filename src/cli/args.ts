import { z, type ZodType } from "zod";
import type { Tool } from "../tools/registry.js";

/**
 * A single derivable CLI flag, distilled from one zod field. The CLI
 * never hand-writes flag definitions — it reads them off the same schema
 * the tool already declares, so flags and validation can never drift.
 */
export interface FlagSpec {
  /** camelCase schema key, e.g. `groupUrlName`. */
  key: string;
  /** kebab-case flag form shown to users, e.g. `group-url-name`. */
  flag: string;
  required: boolean;
  kind: "string" | "number" | "boolean" | "enum";
  /** Allowed values when `kind === "enum"`. */
  choices?: string[];
  description?: string;
}

export type ParseResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

export function kebabToCamel(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function camelToKebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/**
 * Peel zod wrappers (`optional`, `nullable`, `default`) off a field to
 * reach the concrete validator underneath, so we can read its kind and
 * enum choices regardless of how it was decorated.
 */
function unwrap(zt: ZodType): ZodType {
  let current: any = zt;
  while (
    current?.def &&
    (current.def.type === "optional" ||
      current.def.type === "nullable" ||
      current.def.type === "default")
  ) {
    current = current.def.innerType;
  }
  return current as ZodType;
}

function isOptional(zt: ZodType): boolean {
  const type = (zt as any)?.def?.type;
  return type === "optional" || type === "nullable" || type === "default";
}

/** Derive the full flag list for a tool from its zod schema. */
export function buildSpecs(schema: Tool["schema"]): FlagSpec[] {
  return Object.entries(schema).map(([key, field]) => {
    const inner = unwrap(field);
    const innerType = (inner as any)?.def?.type as string | undefined;

    let kind: FlagSpec["kind"] = "string";
    let choices: string[] | undefined;
    if (innerType === "boolean") kind = "boolean";
    else if (innerType === "number") kind = "number";
    else if (innerType === "enum") {
      kind = "enum";
      choices = (inner as any).options ?? Object.values((inner as any).def?.entries ?? {});
    }

    return {
      key,
      flag: camelToKebab(key),
      required: !isOptional(field),
      kind,
      choices,
      description: field.description ?? inner.description,
    };
  });
}

/**
 * Parse CLI tokens (everything after the command word) into a validated
 * args object. Accepts `--flag value`, `--flag=value`, bare `--flag`
 * (boolean true), `--no-flag` (boolean false), and both kebab and camel
 * flag spellings. Final validation runs through the tool's own zod schema
 * so enum membership, required fields, and types are enforced once.
 */
export function parseArgs(schema: Tool["schema"], tokens: string[]): ParseResult {
  const specs = buildSpecs(schema);
  const byKey = new Map(specs.map((s) => [s.key, s]));
  const raw: Record<string, unknown> = {};

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (!token.startsWith("--")) {
      return { ok: false, error: `Unexpected argument: ${token}` };
    }

    let name = token.slice(2);
    let inlineValue: string | undefined;
    const eq = name.indexOf("=");
    if (eq !== -1) {
      inlineValue = name.slice(eq + 1);
      name = name.slice(0, eq);
    }

    // `--no-foo` negates a boolean flag.
    let negated = false;
    if (name.startsWith("no-")) {
      const candidate = kebabToCamel(name.slice(3));
      if (byKey.get(candidate)?.kind === "boolean") {
        negated = true;
        name = name.slice(3);
      }
    }

    const key = kebabToCamel(name);
    const spec = byKey.get(key);
    if (!spec) {
      return { ok: false, error: `Unknown flag: --${camelToKebab(key)}` };
    }

    if (spec.kind === "boolean") {
      if (negated) raw[key] = false;
      else if (inlineValue !== undefined) raw[key] = inlineValue !== "false";
      else raw[key] = true;
      continue;
    }

    let value = inlineValue;
    if (value === undefined) {
      value = tokens[++i];
      if (value === undefined) {
        return { ok: false, error: `Flag --${spec.flag} expects a value` };
      }
    }

    if (spec.kind === "number") {
      const n = Number(value);
      if (Number.isNaN(n)) {
        return { ok: false, error: `Flag --${spec.flag} expects a number, got "${value}"` };
      }
      raw[key] = n;
    } else {
      raw[key] = value;
    }
  }

  const parsed = z.object(schema).safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => {
        const path = issue.path.join(".");
        const flag = path ? `--${camelToKebab(String(path))}` : "argument";
        return `${flag}: ${issue.message}`;
      })
      .join("\n  ");
    return { ok: false, error: `Invalid arguments:\n  ${detail}` };
  }

  return { ok: true, value: parsed.data };
}

/** Render `--help` text for a single tool. */
export function formatHelp(tool: Tool): string {
  const specs = buildSpecs(tool.schema);
  const lines: string[] = [
    `events ${tool.name.replace(/_/g, "-")}`,
    "",
    `  ${tool.description}`,
  ];

  if (specs.length === 0) {
    lines.push("", "  (no flags)");
    return lines.join("\n");
  }

  lines.push("", "Flags:");
  const width = Math.max(...specs.map((s) => s.flag.length));
  for (const spec of specs) {
    const type = spec.kind === "enum" ? `(${spec.choices?.join("|")})` : `<${spec.kind}>`;
    const req = spec.required ? "  [required]" : "";
    const pad = " ".repeat(width - spec.flag.length);
    lines.push(`  --${spec.flag}${pad}  ${type}${req}`);
    if (spec.description) lines.push(`      ${spec.description}`);
  }
  return lines.join("\n");
}
