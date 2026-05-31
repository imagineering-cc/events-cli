#!/usr/bin/env node

import { browser } from "./browser.js";
import { allTools, resolveTool, type Tool } from "./tools/registry.js";
import { formatHelp, parseArgs } from "./cli/args.js";

/** Render the top-level command list. */
function globalHelp(): string {
  const lines: string[] = [
    "events — manage Meetup & Luma events from the command line",
    "",
    "Usage:",
    "  events <command> [--flags]",
    "  events <command> --help     show flags for a command",
    "  events help                 show this list",
    "",
    "Commands:",
  ];
  const width = Math.max(...allTools.map((t) => t.name.length));
  for (const tool of allTools) {
    const name = tool.name.replace(/_/g, "-");
    const pad = " ".repeat(width - tool.name.length);
    const summary = tool.description.split(/(?<=\.)\s/)[0];
    lines.push(`  ${name}${pad}  ${summary}`);
  }
  lines.push(
    "",
    "Aliases: login, logout, status, sync",
    "Sessions are saved to ~/.events-mcp after `events login`.",
  );
  return lines.join("\n");
}

/** Run one tool to completion, always tearing down the browser. */
async function run(tool: Tool, tokens: string[]): Promise<number> {
  const parsed = parseArgs(tool.schema, tokens);
  if (!parsed.ok) {
    process.stderr.write(`${parsed.error}\n\n`);
    process.stderr.write(`${formatHelp(tool)}\n`);
    return 2;
  }

  try {
    const result = await tool.handler(parsed.value);
    process.stdout.write(`${result}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    return 1;
  } finally {
    await browser.shutdown();
  }
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    // `events help <command>` shows that command's flags.
    const target = command === "help" ? rest[0] : undefined;
    if (target) {
      const tool = resolveTool(target);
      if (!tool) {
        process.stderr.write(`Unknown command: ${target}\n`);
        return 1;
      }
      process.stdout.write(`${formatHelp(tool)}\n`);
      return 0;
    }
    process.stdout.write(`${globalHelp()}\n`);
    return 0;
  }

  const tool = resolveTool(command);
  if (!tool) {
    process.stderr.write(
      `Unknown command: ${command}\nRun \`events help\` to see available commands.\n`,
    );
    return 1;
  }

  if (rest.includes("--help") || rest.includes("-h")) {
    process.stdout.write(`${formatHelp(tool)}\n`);
    return 0;
  }

  return run(tool, rest);
}

main().then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`Fatal: ${error?.stack ?? error}\n`);
    process.exit(1);
  },
);
