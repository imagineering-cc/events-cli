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
    const page = await browser.getPage("meetup");

    try {
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
    } finally {
      await page.close();
    }
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
    const page = await browser.getPage("meetup");

    try {
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
    } finally {
      await page.close();
    }
  },
};

/** Edit an existing event on Meetup. */
export const meetupEditEventTool = {
  name: "meetup_edit_event",
  description:
    "Edit an existing Meetup event. Only provided fields are updated. Requires being logged in as an organizer.",
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
    duration: z.number().optional().describe("New duration in minutes"),
    venueName: z.string().optional().describe("New venue name to search for"),
  },
  handler: async ({
    eventUrl,
    title,
    description,
    startDate,
    duration,
    venueName,
  }: {
    eventUrl: string;
    title?: string;
    description?: string;
    startDate?: string;
    duration?: number;
    venueName?: string;
  }) => {
    const page = await browser.getPage("meetup");

    try {
      // Navigate to the event's edit page
      const editUrl = eventUrl.replace(/\/?$/, "/edit/");
      await page.goto(editUrl, { waitUntil: "domcontentloaded" });

      // Update title if provided
      if (title !== undefined) {
        const titleInput = page.locator(
          'input[name="title"], [data-testid="event-title-input"]'
        );
        await titleInput.waitFor({ timeout: 10000 });
        await titleInput.clear();
        await titleInput.fill(title);
      }

      // Update description if provided
      if (description !== undefined) {
        const descEditor = page.locator('[contenteditable="true"]').first();
        await descEditor.waitFor({ timeout: 5000 });
        await descEditor.fill(description);
      }

      // Update date/time if provided
      if (startDate !== undefined) {
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
          await dateInput.clear();
          await dateInput.fill(dateStr);
        }

        const timeInput = page
          .locator('input[name="startTime"], input[type="time"]')
          .first();
        if (await timeInput.isVisible().catch(() => false)) {
          await timeInput.clear();
          await timeInput.fill(timeStr);
        }
      }

      // Update duration if provided
      if (duration !== undefined) {
        const durationSelect = page.locator('select[name="duration"]').first();
        if (await durationSelect.isVisible().catch(() => false)) {
          await durationSelect.selectOption(String(duration));
        }
      }

      // Update venue if provided
      if (venueName !== undefined) {
        const venueInput = page
          .locator('input[name="venue"], input[placeholder*="venue"]')
          .first();
        if (await venueInput.isVisible().catch(() => false)) {
          await venueInput.clear();
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

      // Save changes
      const saveBtn = page
        .locator('button:has-text("Save"), button:has-text("Update")')
        .first();
      await saveBtn.click();

      await page.waitForTimeout(3000);

      const finalUrl = page.url();
      return `Event updated: ${finalUrl}`;
    } finally {
      await page.close();
    }
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
    const page = await browser.getPage("meetup");

    try {
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
    } finally {
      await page.close();
    }
  },
};
