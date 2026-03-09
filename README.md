# events-mcp

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
