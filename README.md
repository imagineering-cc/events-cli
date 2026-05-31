# events-cli

Command-line tool for managing Meetup and Luma events. Uses Playwright browser automation — no paid API tiers required. Designed to be scripted: every operation is a single non-interactive command with predictable flags and exit codes.

## Commands

| Command | Description |
|---------|-------------|
| `events login --platform <meetup\|luma>` | Authenticate (opens a browser window to sign in) |
| `events logout --platform <meetup\|luma>` | Clear the saved session for a platform |
| `events status [--platform <meetup\|luma>]` | Check which platforms have active sessions |
| `events meetup-list-events --group-url-name <name>` | List upcoming events from a Meetup group |
| `events meetup-create-event ...` | Create an event on Meetup |
| `events meetup-update-event --event-url <url> ...` | Edit an existing Meetup event |
| `events meetup-cancel-event --event-url <url> --confirm` | Cancel a Meetup event (destructive) |
| `events meetup-get-rsvps --event-url <url>` | Get the RSVP list for a Meetup event |
| `events luma-list-events` | List upcoming events from your Luma dashboard |
| `events luma-create-event ...` | Create an event on Luma |
| `events luma-update-event --event-url <url> ...` | Edit an existing Luma event |
| `events luma-cancel-event --event-url <url> --confirm` | Cancel a Luma event (destructive) |
| `events luma-get-rsvps --event-url <url>` | Get the guest list for a Luma event |
| `events sync --source-url <url> --target-platform <meetup\|luma>` | Copy an event from one platform to the other |

Short aliases: `login`, `logout`, `status`, `sync`. Both `meetup-create-event` and `meetup_create_event` spellings work.

Run `events help` for the full list, or `events <command> --help` for a command's flags (auto-generated from the underlying schema, so the help is always accurate).

## Setup

```bash
npm install
npx playwright install chromium
npm run build
```

Then either link it onto your `PATH`:

```bash
npm link        # makes `events` available globally
events status
```

…or run it in place without linking:

```bash
npm start -- status                 # via the start script
node dist/cli.js status             # directly
```

## Usage

First, log in once per platform (this opens a real browser window for you to sign in — including any 2FA). The session is saved to `~/.events-mcp/`, so you only do this once:

```bash
events login --platform meetup
events login --platform luma
events status
```

Then drive events from the command line or a script:

```bash
# List what's coming up
events meetup-list-events --group-url-name imagineering-ai-claude-code

# Create a draft (omit --publish to keep it a draft)
events meetup-create-event \
  --group-url-name imagineering-ai-claude-code \
  --title "AI Hack Night" \
  --description "Bring a laptop and an idea." \
  --start-date 2026-06-13T18:00:00 \
  --venue-name "The Loading Bar" \
  --publish

# Change the time and venue of an existing event — only the flags you pass change
events meetup-update-event \
  --event-url https://www.meetup.com/imagineering-ai-claude-code/events/123456789/ \
  --start-date 2026-06-14T18:00:00 \
  --venue-name "Fishburners"

# Cancel an event (destructive — requires the explicit guard flag)
events meetup-cancel-event \
  --event-url https://www.meetup.com/imagineering-ai-claude-code/events/123456789/ \
  --confirm

# Mirror a Luma event onto Meetup
events sync \
  --source-url https://lu.ma/abc123 \
  --target-platform meetup \
  --group-url-name imagineering-ai-claude-code
```

### Flags, exit codes, and scripting

- **Flags are kebab-case** (`--group-url-name`) and map to the underlying field names; camelCase (`--groupUrlName`) and `--flag=value` are also accepted.
- **Booleans** are presence flags: `--publish` sets it true, `--no-publish` sets it false.
- **Exit codes**: `0` success, `1` runtime error (printed to stderr), `2` invalid arguments (usage printed to stderr). This makes the tool safe to chain in scripts with `&&` and to gate on in CI/cron.
- **Output** goes to stdout; list/RSVP commands emit JSON you can pipe into `jq`.

```bash
events meetup-get-rsvps --event-url "$URL" | jq '.count'
```

## Architecture

The tool is a thin CLI **frontend** over a transport-agnostic command registry. Each operation lives in `src/tools/*.ts` as a plain object — `{ name, description, schema, handler }` — and `src/tools/registry.ts` collects them into one list.

**Schema-driven flags** — `src/cli/args.ts` reads each command's zod `schema` and derives its CLI flags: field kinds become flag types, enums become validated choices, optionals become non-required, and `.describe()` text becomes help. There is no hand-written flag table, so flags and validation can never drift from the schema. Adding a new command is a one-file change that automatically gains flags, validation, and `--help`.

**Session persistence** — Browser sessions (cookies, localStorage) are saved to `~/.events-mcp/` so you don't re-authenticate every run.

**BrowserMutex** — An in-process mutex serialises all browser operations so concurrent work can't corrupt the shared Playwright context.

**Session validation on first use** — On the first operation for a platform, the tool loads the site and checks the saved session is still valid, catching stale tokens early instead of failing mid-operation.

**Safe shutdown** — Each command flushes `storageState` and closes the browser before exiting, so sessions survive across invocations.

## Project structure

```
src/
  cli.ts            CLI entry: command dispatch, help, lifecycle
  cli/
    args.ts         Schema-driven flag parsing & validation (pure, unit-tested)
    args.test.ts
  browser.ts        Browser management, session persistence, BrowserMutex
  tools/
    registry.ts     Collects all tools; command/alias resolution
    auth.ts         Login, logout, status
    meetup.ts       Meetup: list, create, update, cancel, RSVPs
    luma.ts         Luma: list, create, update, cancel, RSVPs
    sync.ts         Cross-platform sync
```

## Caveats

Browser automation is inherently fragile. The create/update/cancel commands drive live Meetup and Luma pages via CSS selectors, which can break when those sites change their HTML. If a command starts failing after working fine, a selector probably needs updating — the `*-create-event`, `*-update-event`, and `*-cancel-event` handlers in `src/tools/` are where to look. The CLI framework (parsing, validation, dispatch) is fully unit-tested and stable; the site selectors are best-effort.
