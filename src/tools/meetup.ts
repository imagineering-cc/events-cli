import { z } from "zod";
import { browser } from "../browser.js";

/** List upcoming events from a Meetup group. */
export const meetupListEventsTool = {
  name: "meetup_list_events",
  description:
    "List upcoming events from a Meetup group. Requires being logged in to Meetup.",
  schema: {
    groupUrlName: z
      .string()
      .describe("Meetup group URL name (e.g. 'imagineeering-ai-claude-code')"),
  },
  handler: async ({ groupUrlName }: { groupUrlName: string }) => {
    return browser.withBrowser("meetup", async (page) => {
      await page.goto(`https://www.meetup.com/${groupUrlName}/events/`, {
        waitUntil: "domcontentloaded",
      });

      // Wait for event cards to load
      await page.waitForSelector('[id="event-card-e-"]', { timeout: 5000 }).catch(() => {});

      const events = await page.evaluate(() => {
        const cards = document.querySelectorAll('[id^="event-card"]');
        return Array.from(cards).map((card) => {
          const titleEl = card.querySelector("h2, h3, [data-testid='event-card-title']");
          const timeEl = card.querySelector("time");
          const linkEl = card.querySelector("a[href*='/events/']");
          const venueEl = card.querySelector("[data-testid='event-card-venue']");

          return {
            title: titleEl?.textContent?.trim() ?? "Unknown",
            dateTime: timeEl?.getAttribute("datetime") ?? timeEl?.textContent?.trim() ?? "Unknown",
            venue: venueEl?.textContent?.trim() ?? "Online or TBD",
            url: linkEl?.getAttribute("href") ?? "",
          };
        });
      });

      if (events.length === 0) {
        return "No upcoming events found for this group.";
      }

      return JSON.stringify(events, null, 2);
    });
  },
};

/** Create an event on Meetup. */
export const meetupCreateEventTool = {
  name: "meetup_create_event",
  description:
    "Create a new event on Meetup. Requires being logged in as an organizer.",
  schema: {
    groupUrlName: z.string().describe("Meetup group URL name"),
    title: z.string().describe("Event title"),
    description: z.string().describe("Event description (supports HTML)"),
    startDate: z.string().describe("Start date/time in ISO 8601 format"),
    duration: z
      .number()
      .optional()
      .describe("Duration in minutes (default: 120)"),
    venueName: z
      .string()
      .optional()
      .describe("Venue name to search for, or omit for online event"),
    publish: z
      .boolean()
      .optional()
      .describe("Publish immediately (default: false, saves as draft)"),
  },
  handler: async ({
    groupUrlName,
    title,
    description,
    startDate,
    duration = 120,
    venueName,
    publish = false,
  }: {
    groupUrlName: string;
    title: string;
    description: string;
    startDate: string;
    duration?: number;
    venueName?: string;
    publish?: boolean;
  }) => {
    return browser.withBrowser("meetup", async (page) => {
      // Navigate to event creation page
      await page.goto(
        `https://www.meetup.com/${groupUrlName}/events/create/`,
        { waitUntil: "domcontentloaded" }
      );

      // Fill in the title
      const titleInput = page.locator('input[name="title"], [data-testid="event-title-input"]');
      await titleInput.waitFor({ timeout: 10000 });
      await titleInput.fill(title);

      // Fill in description — Meetup uses a rich text editor
      const descEditor = page.locator('[contenteditable="true"]').first();
      await descEditor.waitFor({ timeout: 5000 });
      await descEditor.fill(description);

      // Set date/time
      const date = new Date(startDate);
      const dateStr = date.toLocaleDateString("en-US", {
        month: "2-digit",
        day: "2-digit",
        year: "numeric",
      });
      const timeStr = date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });

      const dateInput = page.locator('input[name="date"], input[type="date"]').first();
      if (await dateInput.isVisible()) {
        await dateInput.fill(dateStr);
      }

      const timeInput = page.locator('input[name="startTime"], input[type="time"]').first();
      if (await timeInput.isVisible()) {
        await timeInput.fill(timeStr);
      }

      // Set duration if there's a duration field
      const durationSelect = page.locator('select[name="duration"]').first();
      if (await durationSelect.isVisible().catch(() => false)) {
        await durationSelect.selectOption(String(duration));
      }

      // Handle venue
      if (venueName) {
        const venueInput = page.locator('input[name="venue"], input[placeholder*="venue"]').first();
        if (await venueInput.isVisible().catch(() => false)) {
          await venueInput.fill(venueName);
          await page.waitForTimeout(1000);
          // Click first suggestion
          const suggestion = page.locator('[role="option"], [data-testid="venue-suggestion"]').first();
          if (await suggestion.isVisible().catch(() => false)) {
            await suggestion.click();
          }
        }
      }

      // Submit
      if (publish) {
        const publishBtn = page.locator('button:has-text("Publish")').first();
        await publishBtn.click();
      } else {
        const draftBtn = page.locator('button:has-text("Save"), button:has-text("Draft")').first();
        await draftBtn.click();
      }

      await page.waitForTimeout(3000);

      const finalUrl = page.url();
      return `Event ${publish ? "published" : "saved as draft"}: ${finalUrl}`;
    });
  },
};

/** Edit an existing Meetup event. */
export const meetupUpdateEventTool = {
  name: "meetup_update_event",
  description:
    "Edit an existing Meetup event. Only the fields you provide are changed; " +
    "omit a field to leave it as-is. Requires being logged in as an organizer.",
  schema: {
    eventUrl: z.string().describe("Full URL of the Meetup event to edit"),
    title: z.string().optional().describe("New event title"),
    description: z
      .string()
      .optional()
      .describe("New event description (supports HTML)"),
    startDate: z
      .string()
      .optional()
      .describe("New start date/time in ISO 8601 format"),
    venueName: z
      .string()
      .optional()
      .describe("New venue name to search for"),
    publish: z
      .boolean()
      .optional()
      .describe("Publish the changes immediately (default: true)"),
  },
  handler: async ({
    eventUrl,
    title,
    description,
    startDate,
    venueName,
    publish = true,
  }: {
    eventUrl: string;
    title?: string;
    description?: string;
    startDate?: string;
    venueName?: string;
    publish?: boolean;
  }) => {
    if (!title && !description && !startDate && !venueName) {
      return "Nothing to update — provide at least one of: title, description, startDate, venueName.";
    }

    return browser.withBrowser("meetup", async (page) => {
      // Meetup event edit pages live at .../events/<id>/edit
      const editUrl = eventUrl.replace(/\/?$/, "/edit/");
      await page.goto(editUrl, { waitUntil: "domcontentloaded" });

      if (title) {
        const titleInput = page.locator(
          'input[name="title"], [data-testid="event-title-input"]'
        );
        await titleInput.waitFor({ timeout: 10000 });
        await titleInput.fill(title);
      }

      if (description) {
        const descEditor = page.locator('[contenteditable="true"]').first();
        if (await descEditor.isVisible().catch(() => false)) {
          await descEditor.fill(description);
        }
      }

      if (startDate) {
        const date = new Date(startDate);
        const dateStr = date.toLocaleDateString("en-US", {
          month: "2-digit",
          day: "2-digit",
          year: "numeric",
        });
        const timeStr = date.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        });

        const dateInput = page
          .locator('input[name="date"], input[type="date"]')
          .first();
        if (await dateInput.isVisible().catch(() => false)) {
          await dateInput.fill(dateStr);
        }

        const timeInput = page
          .locator('input[name="startTime"], input[type="time"]')
          .first();
        if (await timeInput.isVisible().catch(() => false)) {
          await timeInput.fill(timeStr);
        }
      }

      if (venueName) {
        const venueInput = page
          .locator('input[name="venue"], input[placeholder*="venue"]')
          .first();
        if (await venueInput.isVisible().catch(() => false)) {
          await venueInput.fill(venueName);
          await page.waitForTimeout(1000);
          const suggestion = page
            .locator('[role="option"], [data-testid="venue-suggestion"]')
            .first();
          if (await suggestion.isVisible().catch(() => false)) {
            await suggestion.click();
          }
        }
      }

      // Save the changes
      const saveBtn = page
        .locator(
          publish
            ? 'button:has-text("Publish"), button:has-text("Save")'
            : 'button:has-text("Save"), button:has-text("Draft")'
        )
        .first();
      if (await saveBtn.isVisible().catch(() => false)) {
        await saveBtn.click();
      }

      await page.waitForTimeout(3000);

      return `Event updated: ${page.url()}`;
    });
  },
};

/** Cancel a Meetup event. Destructive — requires explicit confirmation. */
export const meetupCancelEventTool = {
  name: "meetup_cancel_event",
  description:
    "Cancel an existing Meetup event. This is destructive: attendees are " +
    "notified and the event is removed from the schedule. You must pass " +
    "confirm=true to proceed.",
  schema: {
    eventUrl: z.string().describe("Full URL of the Meetup event to cancel"),
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

    return browser.withBrowser("meetup", async (page) => {
      await page.goto(eventUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);

      // Open the organizer actions menu, then click Cancel
      const menuBtn = page
        .locator(
          'button[aria-label*="actions"], button[aria-label*="menu"], button:has-text("Edit")'
        )
        .first();
      if (await menuBtn.isVisible().catch(() => false)) {
        await menuBtn.click();
        await page.waitForTimeout(500);
      }

      const cancelBtn = page
        .locator(
          'button:has-text("Cancel event"), a:has-text("Cancel event"), [role="menuitem"]:has-text("Cancel")'
        )
        .first();
      if (!(await cancelBtn.isVisible().catch(() => false))) {
        return "Could not find a 'Cancel event' control on the page — the Meetup UI may have changed. Cancel manually or update the selector.";
      }
      await cancelBtn.click();
      await page.waitForTimeout(500);

      // Confirm in the dialog that follows
      const confirmBtn = page
        .locator(
          'button:has-text("Cancel event"), button:has-text("Confirm"), button:has-text("Yes")'
        )
        .last();
      if (await confirmBtn.isVisible().catch(() => false)) {
        await confirmBtn.click();
      }

      await page.waitForTimeout(3000);

      return `Event cancelled: ${eventUrl}`;
    });
  },
};

/** Get RSVPs for a Meetup event. */
export const meetupGetRsvpsTool = {
  name: "meetup_get_rsvps",
  description: "Get the RSVP/attendee list for a Meetup event.",
  schema: {
    eventUrl: z.string().describe("Full URL of the Meetup event"),
  },
  handler: async ({ eventUrl }: { eventUrl: string }) => {
    return browser.withBrowser("meetup", async (page) => {
      // Navigate to the event's attendees page
      const attendeesUrl = eventUrl.replace(/\/?$/, "/attendees/");
      await page.goto(attendeesUrl, { waitUntil: "domcontentloaded" });

      await page.waitForTimeout(2000);

      const attendees = await page.evaluate(() => {
        const members = document.querySelectorAll(
          '[data-testid="attendee-list-item"], .attendees-list li, [class*="attendee"]'
        );
        return Array.from(members).map((el) => {
          const nameEl = el.querySelector("a, [class*='name'], h3, h4");
          return {
            name: nameEl?.textContent?.trim() ?? "Unknown",
          };
        });
      });

      if (attendees.length === 0) {
        return "No attendees found (or unable to parse attendee list).";
      }

      return JSON.stringify(
        { count: attendees.length, attendees },
        null,
        2
      );
    });
  },
};
