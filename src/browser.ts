import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { readFile, writeFile, rm } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

/** Directory for persisted sessions and config. */
const DATA_DIR = join(homedir(), ".events-mcp");

/** Supported platforms. */
export type Platform = "meetup" | "luma";

const PLATFORM_URLS: Record<Platform, string> = {
  meetup: "https://www.meetup.com",
  luma: "https://lu.ma",
};

/**
 * Manages a shared Playwright browser instance with per-platform
 * session persistence. Sessions (cookies + localStorage) are saved
 * to disk so users only need to log in once.
 */
class BrowserManager {
  private browser: Browser | null = null;
  private contexts: Map<Platform, BrowserContext> = new Map();

  constructor() {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  /** Path to a platform's saved session file. */
  private sessionPath(platform: Platform): string {
    return join(DATA_DIR, `${platform}-session.json`);
  }

  /** Launch browser if not already running. */
  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await chromium.launch({ headless: true });
    }
    return this.browser;
  }

  /**
   * Get a browser context for a platform, restoring saved session
   * state if available.
   */
  async getContext(platform: Platform): Promise<BrowserContext> {
    const existing = this.contexts.get(platform);
    if (existing) return existing;

    const browser = await this.ensureBrowser();
    const sessionFile = this.sessionPath(platform);

    let context: BrowserContext;
    if (existsSync(sessionFile)) {
      const state = JSON.parse(await readFile(sessionFile, "utf-8"));
      context = await browser.newContext({ storageState: state });
    } else {
      context = await browser.newContext();
    }

    this.contexts.set(platform, context);
    return context;
  }

  /** Get a new page for a platform. */
  async getPage(platform: Platform): Promise<Page> {
    const context = await this.getContext(platform);
    return context.newPage();
  }

  /** Save the current session state for a platform to disk. */
  async saveSession(platform: Platform): Promise<void> {
    const context = this.contexts.get(platform);
    if (!context) return;

    const state = await context.storageState();
    await writeFile(this.sessionPath(platform), JSON.stringify(state, null, 2));
  }

  /** Check if a saved session exists for a platform. */
  hasSession(platform: Platform): boolean {
    return existsSync(this.sessionPath(platform));
  }

  /** Clear saved session for a platform. */
  async clearSession(platform: Platform): Promise<void> {
    const sessionFile = this.sessionPath(platform);
    if (existsSync(sessionFile)) {
      await rm(sessionFile);
    }

    const context = this.contexts.get(platform);
    if (context) {
      await context.close();
      this.contexts.delete(platform);
    }
  }

  /**
   * Open a visible browser for the user to log in manually.
   * Saves the session once they're done.
   */
  async interactiveLogin(platform: Platform): Promise<string> {
    // Close any existing headless context for this platform
    const existing = this.contexts.get(platform);
    if (existing) {
      await existing.close();
      this.contexts.delete(platform);
    }

    // Launch a headed (visible) browser for the user to interact with
    const headedBrowser = await chromium.launch({ headless: false });
    const context = await headedBrowser.newContext();
    const page = await context.newPage();

    await page.goto(PLATFORM_URLS[platform]);

    // Wait for the user to log in — we watch for navigation away from
    // the login/home page, with a generous timeout
    const startUrl = page.url();
    try {
      await page.waitForFunction(
        (start: string) => window.location.href !== start,
        startUrl,
        { timeout: 300_000 } // 5 minutes to log in
      );
      // Give the page a moment to settle after login redirect
      await page.waitForTimeout(3000);
    } catch {
      // Timeout — user might have closed the browser
      await headedBrowser.close();
      return "Login timed out. Please try again.";
    }

    // Save the authenticated session
    const state = await context.storageState();
    await writeFile(
      this.sessionPath(platform),
      JSON.stringify(state, null, 2)
    );

    await headedBrowser.close();

    return `Logged in to ${platform} successfully. Session saved.`;
  }

  /** Check if a platform session is still valid by loading the site. */
  async isSessionValid(platform: Platform): Promise<boolean> {
    if (!this.hasSession(platform)) return false;

    try {
      const page = await this.getPage(platform);
      await page.goto(PLATFORM_URLS[platform], { waitUntil: "domcontentloaded" });

      let loggedIn: boolean;
      if (platform === "meetup") {
        // Meetup shows a "Log in" button when not authenticated
        loggedIn = (await page.locator('a[href*="login"]').count()) === 0;
      } else {
        // Luma shows "Sign In" when not authenticated
        loggedIn = (await page.getByText("Sign In").count()) === 0;
      }

      await page.close();
      return loggedIn;
    } catch {
      return false;
    }
  }

  /** Shut down browser and all contexts. */
  async shutdown(): Promise<void> {
    for (const [platform, context] of this.contexts) {
      await this.saveSession(platform);
      await context.close();
    }
    this.contexts.clear();

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

/** Singleton browser manager instance. */
export const browser = new BrowserManager();
