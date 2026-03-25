# events-mcp

MCP server providing natural language event management across Meetup and Luma. Uses Playwright browser automation — no paid API tiers required.

## Tools

| Tool | Description |
|------|-------------|
| `events_login` | Authenticate with Meetup or Luma (opens browser for OAuth/login) |
| `events_logout` | Clear saved session for a platform |
| `events_auth_status` | Check which platforms have active sessions |
| `meetup_list_events` | List upcoming events from a Meetup group |
| `meetup_create_event` | Create an event on Meetup |
| `meetup_get_rsvps` | Get RSVP list for a Meetup event |
| `luma_list_events` | List upcoming events from Luma |
| `luma_create_event` | Create an event on Luma |
| `luma_get_rsvps` | Get guest list for a Luma event |
| `events_sync` | Copy an event from one platform to the other |

## Setup

```bash
npm install
npx playwright install chromium
npm run build
```

Add to your Claude Code MCP config:

```json
{
  "mcpServers": {
    "events": {
      "command": "node",
      "args": ["/absolute/path/to/events-mcp/dist/index.js"]
    }
  }
}
```

Then ask Claude to manage your events naturally:

> "Create an event called 'AI Hack Night' next Saturday at 6pm at The Loading Bar"
> "List my upcoming Meetup events"
> "Sync my next Meetup event to Luma"

## Architecture

**Session persistence** — Browser sessions (cookies, localStorage) are saved to `~/.events-mcp/` so you don't re-authenticate every time.

**BrowserMutex** — MCP hosts fire parallel tool calls, but Playwright contexts aren't safe for concurrent use. An in-process mutex serialises all browser operations; others queue and wait.

**Session validation on first use** — On the first tool call for a platform, the server navigates to the site and checks whether the saved session is still valid. Catches stale tokens early instead of failing mid-operation.

**Safe shutdown** — SIGINT/SIGTERM handlers flush `storageState` before closing the browser, so sessions survive server restarts.

## Project structure

```
src/
  index.ts          Server entry, tool registration, lifecycle
  browser.ts        Browser management, session persistence, BrowserMutex
  tools/
    auth.ts         Login, logout, status
    meetup.ts       Meetup event operations
    luma.ts         Luma event operations
    sync.ts         Cross-platform sync
```

~1,064 lines of TypeScript total.

## Caveats

Browser automation is inherently fragile. DOM selectors can break when Meetup or Luma update their HTML. If a tool starts failing after working fine, a selector probably needs updating.
