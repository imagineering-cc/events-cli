import type { ZodType } from "zod";
import { loginTool, logoutTool, statusTool } from "./auth.js";
import {
  meetupListEventsTool,
  meetupCreateEventTool,
  meetupUpdateEventTool,
  meetupCancelEventTool,
  meetupGetRsvpsTool,
} from "./meetup.js";
import {
  lumaListEventsTool,
  lumaCreateEventTool,
  lumaUpdateEventTool,
  lumaCancelEventTool,
  lumaGetRsvpsTool,
} from "./luma.js";
import { syncEventTool } from "./sync.js";

/**
 * A transport-agnostic command. Each tool carries everything a frontend
 * needs to expose it: a stable name, human description, a zod `schema`
 * (a record of field validators), and an async `handler` that returns a
 * string to display.
 *
 * Both the CLI (`cli.ts`) and any future host consume this same shape, so
 * a tool added once is available everywhere — no per-frontend wiring.
 */
export interface Tool {
  name: string;
  description: string;
  schema: Record<string, ZodType>;
  // Handlers are written with concrete arg types per tool; from the
  // registry's vantage point the args are validated dynamically, so we
  // accept `any` here rather than threading a generic through every entry.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any) => Promise<string>;
}

/** Every command the events CLI can run, in display order. */
export const allTools: Tool[] = [
  loginTool,
  logoutTool,
  statusTool,
  meetupListEventsTool,
  meetupCreateEventTool,
  meetupUpdateEventTool,
  meetupCancelEventTool,
  meetupGetRsvpsTool,
  lumaListEventsTool,
  lumaCreateEventTool,
  lumaUpdateEventTool,
  lumaCancelEventTool,
  lumaGetRsvpsTool,
  syncEventTool,
];

/**
 * Resolve a user-typed command to a tool. Accepts the canonical name
 * (`meetup_create_event`), its hyphenated form (`meetup-create-event`),
 * and a handful of short aliases for the common verbs.
 */
const ALIASES: Record<string, string> = {
  login: "events_login",
  logout: "events_logout",
  status: "events_auth_status",
  auth: "events_auth_status",
  sync: "events_sync",
};

export function resolveTool(command: string): Tool | undefined {
  const normalised = command.trim().toLowerCase();
  const canonical = ALIASES[normalised] ?? normalised.replace(/-/g, "_");
  return allTools.find((t) => t.name === canonical);
}
