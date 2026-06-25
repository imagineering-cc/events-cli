#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { browser } from "./browser.js";
import { loginTool, logoutTool, statusTool } from "./tools/auth.js";
import {
  meetupListEventsTool,
  meetupCreateEventTool,
  meetupEditEventTool,
  meetupGetRsvpsTool,
} from "./tools/meetup.js";
import {
  lumaListEventsTool,
  lumaCreateEventTool,
  lumaEditEventTool,
  lumaGetRsvpsTool,
  lumaChangePhotoTool,
} from "./tools/luma.js";
import { syncEventTool } from "./tools/sync.js";

const server = new McpServer({
  name: "events-mcp",
  version: "0.1.0",
});

/** Wrap a handler so errors become MCP error responses. */
function safeHandler<T>(handler: (args: T) => Promise<string>) {
  return async (args: T) => {
    try {
      const result = await handler(args);
      return { content: [{ type: "text" as const, text: result }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  };
}

// ── Auth tools ──────────────────────────────────────────────────────

server.tool(
  loginTool.name,
  loginTool.description,
  loginTool.schema,
  safeHandler(loginTool.handler)
);

server.tool(
  logoutTool.name,
  logoutTool.description,
  logoutTool.schema,
  safeHandler(logoutTool.handler)
);

server.tool(
  statusTool.name,
  statusTool.description,
  statusTool.schema,
  safeHandler(statusTool.handler)
);

// ── Meetup tools ────────────────────────────────────────────────────

server.tool(
  meetupListEventsTool.name,
  meetupListEventsTool.description,
  meetupListEventsTool.schema,
  safeHandler(meetupListEventsTool.handler)
);

server.tool(
  meetupCreateEventTool.name,
  meetupCreateEventTool.description,
  meetupCreateEventTool.schema,
  safeHandler(meetupCreateEventTool.handler)
);

server.tool(
  meetupEditEventTool.name,
  meetupEditEventTool.description,
  meetupEditEventTool.schema,
  safeHandler(meetupEditEventTool.handler)
);

server.tool(
  meetupGetRsvpsTool.name,
  meetupGetRsvpsTool.description,
  meetupGetRsvpsTool.schema,
  safeHandler(meetupGetRsvpsTool.handler)
);

// ── Luma tools ──────────────────────────────────────────────────────

server.tool(
  lumaListEventsTool.name,
  lumaListEventsTool.description,
  lumaListEventsTool.schema,
  safeHandler(lumaListEventsTool.handler)
);

server.tool(
  lumaCreateEventTool.name,
  lumaCreateEventTool.description,
  lumaCreateEventTool.schema,
  safeHandler(lumaCreateEventTool.handler)
);

server.tool(
  lumaEditEventTool.name,
  lumaEditEventTool.description,
  lumaEditEventTool.schema,
  safeHandler(lumaEditEventTool.handler)
);

server.tool(
  lumaGetRsvpsTool.name,
  lumaGetRsvpsTool.description,
  lumaGetRsvpsTool.schema,
  safeHandler(lumaGetRsvpsTool.handler)
);

server.tool(
  lumaChangePhotoTool.name,
  lumaChangePhotoTool.description,
  lumaChangePhotoTool.schema,
  safeHandler(lumaChangePhotoTool.handler)
);

// ── Cross-platform tools ────────────────────────────────────────────

server.tool(
  syncEventTool.name,
  syncEventTool.description,
  syncEventTool.schema,
  safeHandler(syncEventTool.handler)
);

// ── Lifecycle ───────────────────────────────────────────────────────

process.on("SIGINT", async () => {
  await browser.shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await browser.shutdown();
  process.exit(0);
});

const transport = new StdioServerTransport();
await server.connect(transport);
