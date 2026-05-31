import { z } from "zod";
import { browser } from "../browser.js";

/** List upcoming events from the user's Luma dashboard. */
export const lumaListEventsTool = {
  name: "luma_list_events",
  description:
    "List upcoming events from your Luma dashboard. Requires being logged in to Luma.",
  schema: {},
  handler: async () => {
    return browser.withBrowser("luma", async (page) => {
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
    });
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
    return browser.withBrowser("luma", async (page) => {
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
    });
  },
};

/** Edit an existing Luma event. */
export const lumaUpdateEventTool = {
  name: "luma_update_event",
  description:
    "Edit an existing Luma event. Only the fields you provide are changed; " +
    "omit a field to leave it as-is. Requires being logged in.",
  schema: {
    eventUrl: z.string().describe("Full URL of the Luma event to edit"),
    title: z.string().optional().describe("New event title"),
    description: z.string().optional().describe("New event description"),
    startDate: z
      .string()
      .optional()
      .describe("New start date/time in ISO 8601 format"),
    location: z.string().optional().describe("New venue or location name"),
  },
  handler: async ({
    eventUrl,
    title,
    description,
    startDate,
    location,
  }: {
    eventUrl: string;
    title?: string;
    description?: string;
    startDate?: string;
    location?: string;
  }) => {
    if (!title && !description && !startDate && !location) {
      return "Nothing to update — provide at least one of: title, description, startDate, location.";
    }

    return browser.withBrowser("luma", async (page) => {
      // Luma's manage/edit view for an event. The event page exposes a
      // "Manage" → "Edit Event" path; navigating to the event then clicking
      // the edit control is the most resilient route across URL shapes.
      await page.goto(eventUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);

      const editControl = page
        .locator(
          'a:has-text("Edit Event"), button:has-text("Edit Event"), a:has-text("Edit"), button:has-text("Edit")'
        )
        .first();
      if (await editControl.isVisible().catch(() => false)) {
        await editControl.click();
        await page.waitForTimeout(2000);
      }

      if (title) {
        const titleInput = page
          .locator(
            'input[placeholder*="Event"], [data-placeholder*="Event"], [contenteditable="true"]'
          )
          .first();
        if (await titleInput.isVisible().catch(() => false)) {
          await titleInput.fill(title);
        }
      }

      if (description) {
        const descInput = page
          .locator('[data-placeholder*="description"], [contenteditable="true"]')
          .nth(1);
        if (await descInput.isVisible().catch(() => false)) {
          await descInput.fill(description);
        }
      }

      if (startDate) {
        const startInput = page
          .locator('input[type="date"], input[name*="start"]')
          .first();
        if (await startInput.isVisible().catch(() => false)) {
          await startInput.fill(startDate.split("T")[0] ?? startDate);
        }
        const timeInput = page
          .locator('input[type="time"], input[name*="time"]')
          .first();
        if (await timeInput.isVisible().catch(() => false)) {
          const time = new Date(startDate).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          });
          await timeInput.fill(time);
        }
      }

      if (location) {
        const locationInput = page
          .locator(
            'input[placeholder*="location"], input[placeholder*="venue"], button:has-text("Add Location")'
          )
          .first();
        if (await locationInput.isVisible().catch(() => false)) {
          await locationInput.click();
          await page.waitForTimeout(500);
          const searchInput = page
            .locator('input[placeholder*="Search"]')
            .first();
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

      // Save changes
      const saveBtn = page
        .locator(
          'button:has-text("Save"), button:has-text("Update"), button:has-text("Done")'
        )
        .first();
      if (await saveBtn.isVisible().catch(() => false)) {
        await saveBtn.click();
      }

      await page.waitForTimeout(3000);

      return `Event updated on Luma: ${page.url()}`;
    });
  },
};

/** Cancel/delete a Luma event. Destructive — requires explicit confirmation. */
export const lumaCancelEventTool = {
  name: "luma_cancel_event",
  description:
    "Cancel an existing Luma event. This is destructive: guests are notified " +
    "and the event is taken down. You must pass confirm=true to proceed.",
  schema: {
    eventUrl: z.string().describe("Full URL of the Luma event to cancel"),
    confirm: z
      .boolean()
      .describe("Must be true to actually cancel — a safety guard"),
  },
  handler: async ({
    eventUrl,
    confirm,
  }: {
    eventUrl: string;
    confirm: boolean;
  }) => {
    if (!confirm) {
      return "Refusing to cancel without confirm=true. Re-run with --confirm to proceed.";
    }

    return browser.withBrowser("luma", async (page) => {
      await page.goto(eventUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);

      // Luma keeps cancel/delete behind the event's settings/manage area.
      const manageControl = page
        .locator(
          'a:has-text("Manage"), button:has-text("Manage"), a:has-text("Settings"), button:has-text("Settings")'
        )
        .first();
      if (await manageControl.isVisible().catch(() => false)) {
        await manageControl.click();
        await page.waitForTimeout(1500);
      }

      const cancelBtn = page
        .locator(
          'button:has-text("Cancel Event"), button:has-text("Delete Event"), a:has-text("Cancel Event")'
        )
        .first();
      if (!(await cancelBtn.isVisible().catch(() => false))) {
        return "Could not find a 'Cancel Event' control — the Luma UI may have changed. Cancel manually or update the selector.";
      }
      await cancelBtn.click();
      await page.waitForTimeout(500);

      // Confirm in the dialog
      const confirmBtn = page
        .locator(
          'button:has-text("Cancel Event"), button:has-text("Delete"), button:has-text("Confirm"), button:has-text("Yes")'
        )
        .last();
      if (await confirmBtn.isVisible().catch(() => false)) {
        await confirmBtn.click();
      }

      await page.waitForTimeout(3000);

      return `Event cancelled on Luma: ${eventUrl}`;
    });
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
    return browser.withBrowser("luma", async (page) => {
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
    });
  },
};
