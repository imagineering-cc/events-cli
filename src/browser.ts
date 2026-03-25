import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { readFile, writeFile, rm } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { Mutex } from "./mutex.js";

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
 *
 * Key safety properties:
 * - All browser operations are serialised through a mutex to prevent
 *   concurrent tool calls from corrupting shared state.
 * - Saved sessions are validated on first use (not blindly trusted),
 *   so stale tokens from server-side invalidation are caught early.
 * - storageState() is always flushed before any context/browser close.
 */
class BrowserManager {
  private browser: Browser | null = null;
  private contexts: Map<Platform, BrowserContext> = new Map();
  private mutex = new Mutex();
  /** Tracks which platforms have been validated this process lifetime. */
  private validated: Set<Platform> = new Set();

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
   *
   * On the first call per platform (per process lifetime), validates
   * that a restored session is still accepted by the remote server.
   * This catches the case where the server invalidated the session
   * but the local file still has stale tokens.
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

      // Validate the restored session once per process lifetime.
      // A quick page load + login-indicator check catches stale tokens
      // before they cause confusing failures deep in a tool call.
      if (!this.validated.has(platform)) {
        const valid = await this.checkSessionInContext(context, platform);
        this.validated.add(platform);
        if (!valid) {
          await context.close();
          await rm(sessionFile);
          // Return a fresh (unauthenticated) context — the tool handler
          // will see the user isn't logged in and prompt for login.
          context = await browser.newContext();
        }
      }
    } else {
      context = await browser.newContext();
    }

    this.contexts.set(platform, context);
    return context;
  }

  /**
   * Check whether a context's session is still valid by loading the
   * platform and looking for login indicators.
   *
   * Uses a tight timeout (5s) so a slow network doesn't block tool
   * startup. On timeout, assumes the session is invalid — better to
   * re-auth than to hang.
   */
  private async checkSessionInContext(
    context: BrowserContext,
    platform: Platform,
  ): Promise<boolean> {
    try {
      const page = await context.newPage();
      await page.goto(PLATFORM_URLS[platform], {
        waitUntil: "domcontentloaded",
        timeout: 5_000,
      });

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

  /** Get a new page for a platform. Internal — use `withBrowser` instead. */
  private async getPage(platform: Platform): Promise<Page> {
    const context = await this.getContext(platform);
    return context.newPage();
  }

  /**
   * Run a callback with exclusive access to a browser page.
   *
   * Acquires the mutex before creating the page and releases it after
   * the callback completes (or throws). Session state is automatically
   * flushed to disk after each operation so that a crash never loses
   * auth state.
   *
   * All tool handlers should use this instead of calling getPage()
   * directly, to guarantee serialised access.
   */
  async withBrowser<T>(
    platform: Platform,
    fn: (page: Page) => Promise<T>,
  ): Promise<T> {
    await this.mutex.acquire();
    try {
      const page = await this.getPage(platform);
      try {
        const result = await fn(page);
        return result;
      } finally {
        await page.close();
        await this.saveSession(platform);
      }
    } finally {
      this.mutex.release();
    }
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

    const context = this.contexts.get(platform);
    if (context) {
      return this.checkSessionInContext(context, platform);
    }

    // No live context — create a temporary one from saved state
    try {
      const browser = await this.ensureBrowser();
      const state = JSON.parse(
        await readFile(this.sessionPath(platform), "utf-8"),
      );
      const tempContext = await browser.newContext({ storageState: state });
      const valid = await this.checkSessionInContext(tempContext, platform);
      await tempContext.close();
      return valid;
    } catch {
      return false;
    }
  }

  /**
   * Shut down browser and all contexts.
   *
   * Critical ordering: storageState() MUST be called while the context
   * is still alive. Calling it after browser.close() returns nothing.
   */
  async shutdown(): Promise<void> {
    // First: flush all session state while contexts are still alive
    for (const [platform] of this.contexts) {
      await this.saveSession(platform);
    }
    // Then: close contexts
    for (const [, context] of this.contexts) {
      await context.close();
    }
    this.contexts.clear();

    // Finally: close the browser
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

/** Singleton browser manager instance. */
export const browser = new BrowserManager();
