import { z } from "zod";
import { browser, type Platform } from "../browser.js";

const PlatformSchema = z.enum(["meetup", "luma"]);

/** Login to a platform via an interactive browser session. */
export const loginTool = {
  name: "events_login",
  description:
    "Log in to Meetup or Luma. Opens a browser window for you to sign in " +
    "(handles OAuth/2FA), then saves the session so you only log in once " +
    "per platform. Re-run when the session expires.",
  schema: {
    platform: PlatformSchema.describe("Platform to log in to"),
  },
  handler: async ({ platform }: { platform: Platform }) => {
    return await browser.interactiveLogin(platform);
  },
};

/** Log out from a platform (clear saved session). */
export const logoutTool = {
  name: "events_logout",
  description: "Log out from Meetup or Luma and clear the saved session.",
  schema: {
    platform: PlatformSchema.describe("Platform to log out from"),
  },
  handler: async ({ platform }: { platform: Platform }) => {
    await browser.clearSession(platform);
    return `Logged out from ${platform}. Session cleared.`;
  },
};

/** Check login status for a platform. */
export const statusTool = {
  name: "events_auth_status",
  description:
    "Check if you're currently logged in to Meetup and/or Luma.",
  schema: {
    platform: PlatformSchema.optional().describe(
      "Check a specific platform, or omit to check both"
    ),
  },
  handler: async ({ platform }: { platform?: Platform }) => {
    const platforms: Platform[] = platform ? [platform] : ["meetup", "luma"];
    const results: string[] = [];

    for (const p of platforms) {
      if (!browser.hasSession(p)) {
        results.push(`${p}: not logged in (no saved session)`);
        continue;
      }
      const valid = await browser.isSessionValid(p);
      results.push(
        valid
          ? `${p}: logged in ✓`
          : `${p}: session expired — run events_login to re-authenticate`
      );
    }

    return results.join("\n");
  },
};
