import { z } from "zod";
import { browser } from "../browser.js";

/**
 * Scrape event details from a platform URL, then create a matching
 * event on the other platform.
 */
export const syncEventTool = {
  name: "events_sync",
  description:
    "Sync an event from one platform to the other. Provide a Meetup or Luma event URL " +
    "and the event will be scraped and re-created on the other platform.",
  schema: {
    sourceUrl: z
      .string()
      .describe("URL of the event to sync (Meetup or Luma)"),
    targetPlatform: z
      .enum(["meetup", "luma"])
      .describe("Platform to create the event on"),
    groupUrlName: z
      .string()
      .optional()
      .describe(
        "Required when target is Meetup — the group URL name to create the event under"
      ),
  },
  handler: async ({
    sourceUrl,
    targetPlatform,
    groupUrlName,
  }: {
    sourceUrl: string;
    targetPlatform: "meetup" | "luma";
    groupUrlName?: string;
  }) => {
    // Determine source platform from URL
    const sourcePlatform = sourceUrl.includes("meetup.com")
      ? "meetup"
      : sourceUrl.includes("lu.ma")
        ? "luma"
        : null;

    if (!sourcePlatform) {
      return "Could not determine source platform from URL. Provide a meetup.com or lu.ma URL.";
    }

    if (sourcePlatform === targetPlatform) {
      return "Source and target platforms are the same. Nothing to sync.";
    }

    if (targetPlatform === "meetup" && !groupUrlName) {
      return "groupUrlName is required when syncing to Meetup.";
    }

    // Scrape event details from source
    const eventData = await browser.withBrowser(sourcePlatform, async (page) => {
      await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);

      if (sourcePlatform === "meetup") {
        return page.evaluate(() => {
          const title =
            document.querySelector("h1")?.textContent?.trim() ?? "Untitled";
          const desc =
            document.querySelector('[data-testid="event-description"], .event-description')
              ?.textContent?.trim() ?? "";
          const time =
            document.querySelector("time")?.getAttribute("datetime") ?? "";
          const venue =
            document.querySelector('[data-testid="venue-name-value"]')
              ?.textContent?.trim() ?? "";
          return { title, description: desc, dateTime: time, location: venue };
        });
      } else {
        return page.evaluate(() => {
          const title =
            document.querySelector("h1, [class*='title']")?.textContent?.trim() ?? "Untitled";
          const desc =
            document.querySelector("[class*='description'], [class*='about']")
              ?.textContent?.trim() ?? "";
          const time =
            document.querySelector("time")?.getAttribute("datetime") ?? "";
          const venue =
            document.querySelector("[class*='location'], [class*='venue']")
              ?.textContent?.trim() ?? "";
          return { title, description: desc, dateTime: time, location: venue };
        });
      }
    });

    // Return the scraped data for the caller to use with create tools
    // (Rather than duplicating create logic, we return structured data that
    // the LLM can pass to the appropriate create tool)
    return JSON.stringify(
      {
        message: `Scraped event from ${sourcePlatform}. Use the ${targetPlatform === "meetup" ? "meetup_create_event" : "luma_create_event"} tool with this data to create it on ${targetPlatform}.`,
        event: eventData,
        targetPlatform,
        ...(groupUrlName ? { groupUrlName } : {}),
      },
      null,
      2
    );
  },
};
