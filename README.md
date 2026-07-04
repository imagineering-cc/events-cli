# events-mcp

> ## ⚠️ DEPRECATED (2026-07-04) — folded into the `social` CLI
>
> Every capability here now lives in **`social`** (`~/.claude/cli-tools/social/social.mjs`),
> re-derived against the live Luma/Meetup UIs (this server's selectors had gone
> stale — Meetup's create form moved to `/<group>/schedule/`, Luma migrated
> `lu.ma → luma.com`, etc.). Prefer the CLI; it shares one Playwright auth harness
> with the rest of `social` (`social auth luma|meetup`).
>
> | events-mcp tool | `social` command |
> |---|---|
> | `luma_list_events` | `social luma list` |
> | `luma_create_event` | `social luma create --title … --start "Sat 5 Jul" --start-time 18:00` |
> | `luma_edit_event` | `social luma edit --event evt-… --title …` |
> | `luma_change_photo` | `social luma change-photo --event evt-… --search tech` |
> | `luma_get_rsvps` | `social luma guests --event evt-…` |
> | `meetup_list_events` | `social meetup list --group <url-name>` |
> | `meetup_create_event` | `social meetup create --group … --title … --date YYYY-MM-DD --description …` |
> | `meetup_edit_event` | `social meetup edit --group … --event <id> --title …` |
> | (delete) | `social luma delete` / `social meetup delete` |
> | `events_sync` | `social sync --from <url> --to luma\|meetup [--group …]` |
>
> Not yet ported: per-event Meetup attendee list (`meetup_get_rsvps`). Kept here
> for reference/history only — not wired to any live MCP config.

MCP server for managing events across Meetup and Luma via browser automation (Playwright).

No paid API tiers required — uses Playwright to automate the browser directly.

## Features

- Create events on Meetup and/or Luma
- List upcoming events
- Sync events between platforms
- View and manage RSVPs
- Natural language event management via Claude Code or Dreamfinder

## Tech Stack

- TypeScript
- Playwright (browser automation)
- MCP SDK (`@modelcontextprotocol/sdk`)

## Setup

```bash
npm install
npx playwright install chromium
```

## Usage

Add to your Claude Code MCP config:

```json
{
  "mcpServers": {
    "events": {
      "command": "node",
      "args": ["dist/index.js"]
    }
  }
}
```

Then ask Claude to manage your events naturally:

> "Create an event called 'AI Hack Night' next Saturday at 6pm at The Loading Bar"
> "List my upcoming Meetup events"
> "Sync my next Meetup event to Luma"
