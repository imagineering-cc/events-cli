import { z } from "zod";
import { browser } from "../browser.js";

/** List upcoming events from the user's Luma dashboard. */
export const lumaListEventsTool = {
  name: "luma_list_events",
  description:
    "List upcoming events from your Luma dashboard. Requires being logged in to Luma.",
  schema: {},
  handler: async () => {
    const page = await browser.getPage("luma");

    try {
      await page.goto("https://lu.ma/home", {
        waitUntil: "domcontentloaded",
      });

      await page.waitForTimeout(3000);

      const events = await page.evaluate(() => {
        // Luma renders event cards with links to /event/<slug>
        const links = document.querySelectorAll('a[href*="/event/"]');
        const seen = new Set<string>();

        return Array.from(links)
          .map((link) => {
            const href = (link as HTMLAnchorElement).href;
            if (seen.has(href)) return null;
            seen.add(href);

            const card = link.closest("[class*='card'], [class*='event'], div");
            const titleEl = card?.querySelector("h2, h3, [class*='title']");
            const timeEl = card?.querySelector("time, [class*='date'], [class*='time']");

            return {
              title: titleEl?.textContent?.trim() ?? link.textContent?.trim() ?? "Unknown",
              dateTime: timeEl?.getAttribute("datetime") ?? timeEl?.textContent?.trim() ?? "Unknown",
              url: href,
            };
          })
          .filter(Boolean);
      });

      if (events.length === 0) {
        return "No upcoming events found on your Luma dashboard.";
      }

      return JSON.stringify(events, null, 2);
    } finally {
      await page.close();
    }
  },
};

/** Create an event on Luma. */
export const lumaCreateEventTool = {
  name: "luma_create_event",
  description:
    "Create a new event on Luma. Requires being logged in.",
  schema: {
    title: z.string().describe("Event title"),
    description: z.string().optional().describe("Event description"),
    startDate: z.string().describe("Start date/time in ISO 8601 format"),
    endDate: z.string().optional().describe("End date/time in ISO 8601 format"),
    location: z
      .string()
      .optional()
      .describe("Venue or location name, or omit for online event"),
  },
  handler: async ({
    title,
    description,
    startDate,
    endDate,
    location,
  }: {
    title: string;
    description?: string;
    startDate: string;
    endDate?: string;
    location?: string;
  }) => {
    const page = await browser.getPage("luma");

    try {
      await page.goto("https://lu.ma/create", {
        waitUntil: "domcontentloaded",
      });

      await page.waitForTimeout(2000);

      // Fill title — Luma uses a contenteditable or input for the event name
      const titleInput = page.locator(
        'input[placeholder*="Event"], [data-placeholder*="Event"], [contenteditable="true"]'
      ).first();
      await titleInput.waitFor({ timeout: 10000 });
      await titleInput.fill(title);

      // Fill description if provided
      if (description) {
        const descInput = page.locator(
          '[data-placeholder*="description"], [contenteditable="true"]'
        ).nth(1);
        if (await descInput.isVisible().catch(() => false)) {
          await descInput.fill(description);
        }
      }

      // Set date — click the date area and fill in
      const dateArea = page.locator('[class*="date"], button:has-text("Date")').first();
      if (await dateArea.isVisible().catch(() => false)) {
        await dateArea.click();
        await page.waitForTimeout(500);

        // Luma's date picker varies — try to find date/time inputs
        const startInput = page.locator('input[type="date"], input[name*="start"]').first();
        if (await startInput.isVisible().catch(() => false)) {
          await startInput.fill(startDate.split("T")[0] ?? startDate);
        }

        const timeInput = page.locator('input[type="time"], input[name*="time"]').first();
        if (await timeInput.isVisible().catch(() => false)) {
          const time = new Date(startDate).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          });
          await timeInput.fill(time);
        }
      }

      // Set location if provided
      if (location) {
        const locationInput = page.locator(
          'input[placeholder*="location"], input[placeholder*="venue"], button:has-text("Add Location")'
        ).first();
        if (await locationInput.isVisible().catch(() => false)) {
          await locationInput.click();
          await page.waitForTimeout(500);
          const searchInput = page.locator('input[placeholder*="Search"]').first();
          if (await searchInput.isVisible().catch(() => false)) {
            await searchInput.fill(location);
            await page.waitForTimeout(1000);
            const suggestion = page.locator('[role="option"]').first();
            if (await suggestion.isVisible().catch(() => false)) {
              await suggestion.click();
            }
          }
        }
      }

      // Publish / create
      const publishBtn = page.locator(
        'button:has-text("Create Event"), button:has-text("Publish")'
      ).first();
      if (await publishBtn.isVisible().catch(() => false)) {
        await publishBtn.click();
      }

      await page.waitForTimeout(3000);

      const finalUrl = page.url();
      return `Event created on Luma: ${finalUrl}`;
    } finally {
      await page.close();
    }
  },
};

/** Get guests/RSVPs for a Luma event. */
export const lumaGetRsvpsTool = {
  name: "luma_get_rsvps",
  description: "Get the guest list for a Luma event.",
  schema: {
    eventUrl: z.string().describe("Full URL of the Luma event"),
  },
  handler: async ({ eventUrl }: { eventUrl: string }) => {
    const page = await browser.getPage("luma");

    try {
      await page.goto(eventUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);

      // Look for a "Guests" or attendee section
      const guestsLink = page.locator('a:has-text("Guests"), button:has-text("Guests")').first();
      if (await guestsLink.isVisible().catch(() => false)) {
        await guestsLink.click();
        await page.waitForTimeout(2000);
      }

      const guests = await page.evaluate(() => {
        const items = document.querySelectorAll(
          '[class*="guest"], [class*="attendee"], [class*="avatar"]'
        );
        return Array.from(items).map((el) => {
          const nameEl = el.querySelector('[class*="name"], span, p');
          return {
            name: nameEl?.textContent?.trim() ?? el.textContent?.trim() ?? "Unknown",
          };
        });
      });

      if (guests.length === 0) {
        return "No guests found (or unable to parse guest list).";
      }

      return JSON.stringify({ count: guests.length, guests }, null, 2);
    } finally {
      await page.close();
    }
  },
};
