// Read-only diagnostic: open a Meetup event's edit page with the saved
// session and report (a) whether our update-tool selectors match and
// (b) the actual DOM (input names, button labels) so we can fix the real
// selectors precisely. Mutates nothing — never fills or saves.
//
//   node scripts/probe-meetup-edit.mjs <eventUrl> [--headed]
//
// Requires `events login --platform meetup` to have saved a session first.

import { chromium } from "playwright";
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

const eventUrl = process.argv[2];
if (!eventUrl || eventUrl.startsWith("--")) {
  console.error("usage: node scripts/probe-meetup-edit.mjs <eventUrl> [--headed]");
  process.exit(1);
}
const headed = process.argv.includes("--headed");

const sessionPath = join(homedir(), ".events-mcp", "meetup-session.json");
let state;
try {
  state = JSON.parse(await readFile(sessionPath, "utf8"));
} catch {
  console.error(`No saved Meetup session at ${sessionPath}. Run: events login --platform meetup`);
  process.exit(1);
}

const browser = await chromium.launch({ headless: !headed });
const ctx = await browser.newContext({ storageState: state });
const page = await ctx.newPage();

const editUrl = eventUrl.replace(/\/?$/, "/edit/");
console.log("→ navigating to:", editUrl);
await page.goto(editUrl, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
console.log("→ landed on:    ", page.url());
console.log("→ page title:   ", await page.title());

const loginLinks = await page.locator('a[href*="login"]').count();
console.log(`→ session: ${loginLinks > 0 ? "LOGGED OUT (login links present)" : "logged in"}`);

// The exact selectors meetup_update_event relies on.
const probes = {
  "title input": 'input[name="title"], [data-testid="event-title-input"]',
  "description (contenteditable)": '[contenteditable="true"]',
  "date input": 'input[name="date"], input[type="date"]',
  "time input": 'input[name="startTime"], input[type="time"]',
  "venue input": 'input[name="venue"], input[placeholder*="venue"]',
  "save/publish button": 'button:has-text("Publish"), button:has-text("Save")',
};
console.log("\n--- selector match check (what the tool targets) ---");
for (const [label, sel] of Object.entries(probes)) {
  const count = await page.locator(sel).count();
  console.log(`  ${count > 0 ? "✓" : "✗"} ${label}: ${count}`);
}

// Ground truth: what's actually on the page.
console.log("\n--- actual <input> elements (first 30) ---");
const inputs = await page.$$eval("input", (els) =>
  els.slice(0, 30).map((e) => ({
    name: e.getAttribute("name") || undefined,
    type: e.getAttribute("type") || undefined,
    placeholder: e.getAttribute("placeholder") || undefined,
    id: e.id || undefined,
    testid: e.getAttribute("data-testid") || undefined,
  })),
);
console.log(JSON.stringify(inputs, null, 2));

console.log("\n--- contenteditable elements (count + first label) ---");
const editables = await page.$$eval('[contenteditable="true"]', (els) =>
  els.map((e) => e.getAttribute("aria-label") || e.getAttribute("data-placeholder") || "(no label)"),
);
console.log(JSON.stringify(editables, null, 2));

console.log("\n--- <button> labels (first 30) ---");
const buttons = await page.$$eval("button", (els) =>
  els.slice(0, 30).map((e) => e.textContent?.trim()).filter(Boolean),
);
console.log(JSON.stringify(buttons, null, 2));

await browser.close();
console.log("\n✓ probe complete — nothing was modified.");
