import { chromium, type BrowserContext, type Page } from "playwright";
import { existsSync, mkdirSync, rmSync } from "fs";
import { homedir } from "os";
import { join } from "path";

/** Directory for persisted browser profiles and config. */
const DATA_DIR = join(homedir(), ".events-mcp");

/** Supported platforms. */
export type Platform = "meetup" | "luma";

const PLATFORM_URLS: Record<Platform, string> = {
  meetup: "https://www.meetup.com",
  luma: "https://lu.ma",
};

/**
 * Manages Playwright browser contexts with per-platform session
 * persistence using `userDataDir` (persistent browser profiles).
 *
 * Unlike `storageState()` which only captures cookies and localStorage,
 * persistent profiles preserve the full browser state — cookies,
 * localStorage, IndexedDB, service workers, and cached credentials.
 * This is essential for platforms like Luma that store auth tokens
 * in places `storageState()` doesn't reach.
 */
class BrowserManager {
  private contexts: Map<Platform, BrowserContext> = new Map();

  constructor() {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  /** Path to a platform's persistent browser profile directory. */
  private profileDir(platform: Platform): string {
    return join(DATA_DIR, `${platform}-profile`);
  }

  /**
   * Get a headless persistent browser context for a platform.
   * The profile directory retains all state between runs.
   */
  async getContext(platform: Platform): Promise<BrowserContext> {
    const existing = this.contexts.get(platform);
    if (existing) return existing;

    const profileDir = this.profileDir(platform);
    if (!existsSync(profileDir)) {
      mkdirSync(profileDir, { recursive: true });
    }

    const context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
    });

    this.contexts.set(platform, context);
    return context;
  }

  /** Get a new page for a platform. */
  async getPage(platform: Platform): Promise<Page> {
    const context = await this.getContext(platform);
    return context.newPage();
  }

  /** Check if a browser profile exists for a platform. */
  hasSession(platform: Platform): boolean {
    return existsSync(this.profileDir(platform));
  }

  /** Clear saved session for a platform by deleting the profile. */
  async clearSession(platform: Platform): Promise<void> {
    // Close any active context first
    const context = this.contexts.get(platform);
    if (context) {
      await context.close();
      this.contexts.delete(platform);
    }

    const profileDir = this.profileDir(platform);
    if (existsSync(profileDir)) {
      rmSync(profileDir, { recursive: true, force: true });
    }
  }

  /**
   * Open a visible browser for the user to log in manually.
   * Uses a persistent profile so all auth state is preserved
   * to disk automatically — no manual export needed.
   */
  async interactiveLogin(platform: Platform): Promise<string> {
    // Close any existing headless context — can't share a profile dir
    const existing = this.contexts.get(platform);
    if (existing) {
      await existing.close();
      this.contexts.delete(platform);
    }

    const profileDir = this.profileDir(platform);
    if (!existsSync(profileDir)) {
      mkdirSync(profileDir, { recursive: true });
    }

    // Launch a headed (visible) browser with the persistent profile.
    // Use the system Chrome install (`channel: 'chrome'`) so Google OAuth
    // doesn't block sign-in — Playwright's bundled Chromium is flagged as
    // an automation browser and Google rejects it.
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      channel: "chrome",
    });
    const page = context.pages()[0] ?? (await context.newPage());

    const platformUrl = PLATFORM_URLS[platform];
    await page.goto(platformUrl);

    // Poll until the user completes the full login flow (up to 5 minutes).
    // During OAuth, the page URL will be on an external provider (e.g.
    // accounts.google.com) — we simply skip those polls and wait for the
    // user to land back on the platform in an authenticated state.
    const LOGIN_TIMEOUT = 300_000; // 5 minutes
    const POLL_INTERVAL = 2_000;
    const startTime = Date.now();
    const platformHost = new URL(platformUrl).hostname;

    let authenticated = false;
    while (!authenticated && Date.now() - startTime < LOGIN_TIMEOUT) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));

      try {
        // Skip if the browser is on an OAuth provider page
        if (!page.url().includes(platformHost)) continue;

        // Wait for the page to be ready before querying the DOM
        await page.waitForLoadState("domcontentloaded");

        if (platform === "meetup") {
          authenticated =
            (await page.locator('a[href*="login"]').count()) === 0 &&
            !page.url().includes("login");
        } else {
          authenticated =
            (await page.getByText("Sign In").count()) === 0 &&
            !page.url().includes("signin");
        }
      } catch {
        // Page may be navigating between sites — ignore and retry
      }
    }

    if (!authenticated) {
      await context.close();
      return "Login timed out after 5 minutes. Please try again.";
    }

    // Let the page fully settle so all auth state is flushed to the profile
    await new Promise((r) => setTimeout(r, 3000));

    // Close the headed context — the profile dir retains all state on disk
    await context.close();

    return `Logged in to ${platform} successfully. Session saved.`;
  }

  /** Check if a platform session is still valid by loading the site. */
  async isSessionValid(platform: Platform): Promise<boolean> {
    if (!this.hasSession(platform)) return false;

    try {
      const page = await this.getPage(platform);
      await page.goto(PLATFORM_URLS[platform], {
        waitUntil: "domcontentloaded",
      });

      // Wait for JS to render auth state
      await page.waitForTimeout(3000);

      let loggedIn: boolean;
      if (platform === "meetup") {
        loggedIn = (await page.locator('a[href*="login"]').count()) === 0;
      } else {
        loggedIn = (await page.getByText("Sign In").count()) === 0;
      }

      await page.close();
      return loggedIn;
    } catch {
      return false;
    }
  }

  /** Shut down all contexts. */
  async shutdown(): Promise<void> {
    for (const [, context] of this.contexts) {
      await context.close();
    }
    this.contexts.clear();
  }
}

/** Singleton browser manager instance. */
export const browser = new BrowserManager();
