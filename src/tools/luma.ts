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
        waitUntil: "networkidle",
      });

      // Luma is a React SPA — wait for event cards to render
      await page.waitForTimeout(5000);

      // Scrape event cards from the dashboard. Each card has an <a> to
      // /event/manage/<id> and an <h3> with the event title. The card
      // text contains the date, time, location, and guest count as
      // separate lines.
      const events = await page.evaluate(() => {
        const links = document.querySelectorAll('a[href*="/event/manage/"]');
        const seen = new Set<string>();
        const results: { title: string; dateTime: string; url: string }[] = [];

        for (const link of links) {
          const href = (link as HTMLAnchorElement).href;
          if (seen.has(href)) continue;
          seen.add(href);

          // Walk up to find the card container
          let card: HTMLElement | null = link as HTMLElement;
          for (let i = 0; i < 8 && card?.parentElement; i++) {
            card = card.parentElement;
            if (card.children.length >= 3) break;
          }

          // Title is in the <h3> within the card
          const h3 = card?.querySelector("h3");
          const title = h3?.innerText?.trim() ?? "Unknown";

          // Extract all text lines from the card for date/time info
          const text = card?.innerText?.trim() ?? "";
          const lines = text
            .split("\n")
            .map((l: string) => l.trim())
            .filter(
              (l: string) =>
                l.length > 0 &&
                l !== title &&
                l !== "Manage Event" &&
                l !== "No guests"
            );

          // Date lines are typically the first few: e.g. "28 Mar", "Saturday", "19:00"
          const dateTime = lines.slice(0, 3).join(" · ") || "Unknown";

          results.push({ title, dateTime, url: href });
        }

        return results;
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

/**
 * Extract the event ID from various Luma URL formats.
 * Supports: /event/manage/<id>, /event/<id>, /<slug> (with evt- prefix).
 */
function extractEventId(url: string): string | null {
  const u = new URL(url);
  // /event/manage/evt-xxx or /event/evt-xxx
  const eventMatch = u.pathname.match(/\/event\/(?:manage\/)?(evt-[A-Za-z0-9]+)/);
  if (eventMatch) return eventMatch[1]!;
  return null;
}

/** Edit an existing event on Luma. */
export const lumaEditEventTool = {
  name: "luma_edit_event",
  description:
    "Edit an existing Luma event. Only provided fields are updated. Requires being logged in.",
  schema: {
    eventUrl: z.string().describe("Full URL of the Luma event to edit (manage or public URL)"),
    title: z.string().optional().describe("New event title"),
    description: z.string().optional().describe("New event description"),
    startDate: z
      .string()
      .optional()
      .describe("New start date in 'ddd D MMM' format, e.g. 'Sat 25 Apr'"),
    startTime: z
      .string()
      .optional()
      .describe("New start time in HH:MM 24-hour format, e.g. '19:00'"),
    endTime: z
      .string()
      .optional()
      .describe("New end time in HH:MM 24-hour format, e.g. '21:00'"),
    location: z.string().optional().describe("New venue or location name"),
  },
  handler: async ({
    eventUrl,
    title,
    description,
    startDate,
    startTime,
    endTime,
    location,
  }: {
    eventUrl: string;
    title?: string;
    description?: string;
    startDate?: string;
    startTime?: string;
    endTime?: string;
    location?: string;
  }) => {
    const page = await browser.getPage("luma");
    const fieldsUpdated: string[] = [];

    try {
      // Ensure we navigate to the manage overview page
      const eventId = extractEventId(eventUrl);
      const manageUrl = eventId
        ? `https://luma.com/event/manage/${eventId}/overview`
        : eventUrl;

      await page.goto(manageUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);

      // Open the edit panel — Luma uses an "Edit Event" button on the
      // manage overview page that opens a modal/drawer with form fields.
      const editBtn = page.getByRole("button", { name: "Edit Event" });
      await editBtn.waitFor({ timeout: 10000 });
      await editBtn.click();
      await page.waitForTimeout(2000);

      // The edit panel contains a "Basic Info" section with:
      //   - A textbox for the title (first textbox in the panel)
      //   - A textbox for the description (labelled "Description")
      // And a "Time" section with date/time textboxes.

      // Update title — it's the first textbox under "Basic Info"
      if (title !== undefined) {
        const heading = page.getByRole("heading", { name: "Basic Info" });
        await heading.waitFor({ timeout: 5000 });
        // The title textbox is the first sibling textbox after the heading
        const titleInput = heading.locator("~ [role='textbox'], ~ input").first();
        // Fallback: find by current value if the sibling selector doesn't work
        const input = (await titleInput.count()) > 0
          ? titleInput
          : page.locator("[role='textbox']").first();
        await input.waitFor({ timeout: 5000 });
        await input.clear();
        await input.fill(title);
        fieldsUpdated.push("title");
      }

      // Update description
      if (description !== undefined) {
        const descLabel = page.locator("text=Description").first();
        if (await descLabel.isVisible().catch(() => false)) {
          const descInput = descLabel
            .locator(".. >> [role='textbox'], .. >> textarea")
            .first();
          if (await descInput.isVisible().catch(() => false)) {
            await descInput.clear();
            await descInput.fill(description);
            fieldsUpdated.push("description");
          }
        }
      }

      // Update date/time — the "Time" section has textboxes for date and
      // two HH:MM inputs for start/end time.
      if (startDate !== undefined) {
        const timeHeading = page.getByRole("heading", { name: "Time" });
        if (await timeHeading.isVisible().catch(() => false)) {
          const dateInput = timeHeading
            .locator(".. >> [role='textbox']")
            .first();
          if (await dateInput.isVisible().catch(() => false)) {
            await dateInput.clear();
            await dateInput.fill(startDate);
            fieldsUpdated.push("date");
          }
        }
      }

      if (startTime !== undefined) {
        const timeInputs = page.locator("[placeholder='HH:MM']");
        const first = timeInputs.first();
        if (await first.isVisible().catch(() => false)) {
          await first.clear();
          await first.fill(startTime);
          fieldsUpdated.push("startTime");
        }
      }

      if (endTime !== undefined) {
        const timeInputs = page.locator("[placeholder='HH:MM']");
        const second = timeInputs.nth(1);
        if (await second.isVisible().catch(() => false)) {
          await second.clear();
          await second.fill(endTime);
          fieldsUpdated.push("endTime");
        }
      }

      // Update location
      if (location !== undefined) {
        const locationInput = page.locator(
          "[placeholder=\"What's the address?\"]"
        );
        if (await locationInput.isVisible().catch(() => false)) {
          await locationInput.clear();
          await locationInput.fill(location);
          await page.waitForTimeout(1000);
          // Select the first autocomplete suggestion if one appears
          const suggestion = page.locator("[role='option']").first();
          if (await suggestion.isVisible({ timeout: 3000 }).catch(() => false)) {
            await suggestion.click();
          }
          fieldsUpdated.push("location");
        }
      }

      if (fieldsUpdated.length === 0) {
        await page.close();
        return "No fields were updated — none of the provided fields could be found in the edit form.";
      }

      // Save changes — Luma uses "Update Event" as the submit button
      const updateBtn = page.getByRole("button", { name: "Update Event" });
      await updateBtn.waitFor({ timeout: 5000 });
      await updateBtn.click();
      await page.waitForTimeout(3000);

      // Verify the update by checking the page title
      const pageTitle = await page.title();
      return `Event updated on Luma (fields: ${fieldsUpdated.join(", ")}). Page title: ${pageTitle}`;
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

/**
 * Change the cover photo of a Luma event.
 *
 * Supports two modes:
 * - **search**: Search Luma's built-in library (Luma-designed + Unsplash)
 *   and pick the Nth result (defaults to the first).
 * - **upload**: Upload a local image file from an absolute path.
 */
export const lumaChangePhotoTool = {
  name: "luma_change_photo",
  description:
    "Change the cover photo of a Luma event. Either search Luma's image library or upload a local file.",
  schema: {
    eventUrl: z
      .string()
      .describe("Full URL of the Luma event (manage or public URL)"),
    search: z
      .string()
      .optional()
      .describe("Search query for Luma's image library (e.g. 'tech', 'hackathon')"),
    category: z
      .string()
      .optional()
      .describe(
        "Browse a category instead of searching. One of: Tech, Business, Party, Crypto, Abstract, etc."
      ),
    imageIndex: z
      .number()
      .optional()
      .describe(
        "Which image to pick from search/category results (0-based, default 0 = first image)"
      ),
    filePath: z
      .string()
      .optional()
      .describe("Absolute path to a local image file to upload"),
  },
  handler: async ({
    eventUrl,
    search,
    category,
    imageIndex = 0,
    filePath,
  }: {
    eventUrl: string;
    search?: string;
    category?: string;
    imageIndex?: number;
    filePath?: string;
  }) => {
    const page = await browser.getPage("luma");

    try {
      // Navigate to the manage overview page
      const eventId = extractEventId(eventUrl);
      const manageUrl = eventId
        ? `https://luma.com/event/manage/${eventId}/overview`
        : eventUrl;

      await page.goto(manageUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);

      // Open the image picker modal
      const changePhotoBtn = page.getByRole("button", {
        name: "Change Photo",
      });
      await changePhotoBtn.waitFor({ timeout: 10000 });
      await changePhotoBtn.click();
      await page.waitForTimeout(2000);

      if (filePath) {
        // Upload a local file via the hidden file input
        const fileInput = page.locator('input[type="file"]');
        await fileInput.setInputFiles(filePath);
        await page.waitForTimeout(3000);

        // Check for success status
        const status = page.locator("status, [role='status']");
        const statusText = await status.innerText().catch(() => "");
        return statusText.includes("success")
          ? "Cover photo uploaded successfully!"
          : "File uploaded — check the event page to confirm.";
      }

      if (search) {
        // Type into the search box
        const searchInput = page.getByPlaceholder("Search for more photos");
        await searchInput.waitFor({ timeout: 5000 });
        await searchInput.fill(search);
        await page.waitForTimeout(2000);
      } else if (category) {
        // Click the category tab — there are two sets of category buttons
        // (tab strip and gallery cards). Click the gallery card version
        // which has the category name as text content.
        const categoryBtn = page
          .locator(`button:has-text("${category}")`)
          .last();
        await categoryBtn.waitFor({ timeout: 5000 });
        await categoryBtn.click();
        await page.waitForTimeout(2000);
      }

      // Find all image buttons in the results area. Each is a <button>
      // wrapping an <img> with no text content.
      const imageButtons = page.locator(
        "button:has(img):not(:has-text('a'))"
      );

      // Filter to only the ones inside the image grid (after search/category
      // controls), which have no meaningful text.
      const count = await imageButtons.count();

      // Skip category/nav buttons — look for buttons that contain an img
      // and have minimal or no text (pure image buttons).
      let picked = false;
      let idx = 0;
      for (let i = 0; i < count; i++) {
        const btn = imageButtons.nth(i);
        const text = await btn.innerText().catch(() => "");
        // Image-only buttons have empty or whitespace-only text
        if (text.trim().length === 0) {
          if (idx === imageIndex) {
            await btn.click();
            picked = true;
            break;
          }
          idx++;
        }
      }

      if (!picked) {
        return `Could not find image at index ${imageIndex}. Only found ${idx} images.`;
      }

      await page.waitForTimeout(2000);

      // Check for success
      const status = page.locator("status, [role='status']");
      const statusText = await status
        .innerText({ timeout: 5000 })
        .catch(() => "");

      return statusText.includes("success")
        ? "Cover photo changed successfully!"
        : "Image selected — check the event page to confirm.";
    } finally {
      await page.close();
    }
  },
};
