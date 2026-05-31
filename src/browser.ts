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
 * The platform's own domain. Used to tell "logged in and back on the
 * platform" apart from "currently on a third-party OAuth provider"
 * (e.g. accounts.google.com) during an interactive login.
 */
const LOGIN_HOST: Record<Platform, string> = {
  meetup: "meetup.com",
  luma: "lu.ma",
};

/** Login/signup path segments that mean "definitely not logged in yet". */
const LOGIN_PATH_RE = /\b(login|signin|sign-in|signup|sign-up)\b/;

/**
 * URL-level precondition for a logged-in page: we're on the platform's own
 * domain (not a third-party OAuth provider mid-sign-in) AND not sitting on a
 * login/signup path.
 *
 * Pure and exported for testing because this is the check whose absence let a
 * failed credential login read the login page as "logged in" (the login page
 * has no logged-out *link*) and overwrite a good saved session. The path guard
 * makes that false-positive impossible.
 */
export function isLoggedInUrl(currentUrl: string, platform: Platform): boolean {
  let url: URL;
  try {
    url = new URL(currentUrl);
  } catch {
    return false;
  }
  if (!url.hostname.endsWith(LOGIN_HOST[platform])) return false;
  return !LOGIN_PATH_RE.test(url.pathname);
}

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
      const loggedIn = await this.pageShowsLoggedIn(page, platform);
      await page.close();
      return loggedIn;
    } catch {
      return false;
    }
  }

  /**
   * Whether the page *as it currently stands* shows a logged-in state for
   * the platform. Two conditions, both required:
   *
   *  1. We're on the platform's own domain — not a third-party OAuth
   *     provider. Without this, an in-progress Google/Facebook sign-in
   *     page (which has no Meetup "login" link) would read as logged in.
   *  2. The platform's logged-out marker is absent (Meetup shows a login
   *     link when signed out; Luma shows "Sign In").
   *
   * Does not navigate — it inspects whatever the page is showing now, so
   * callers can poll it during an interactive login.
   */
  private async pageShowsLoggedIn(
    page: Page,
    platform: Platform,
  ): Promise<boolean> {
    if (!isLoggedInUrl(page.url(), platform)) return false;

    try {
      if (platform === "meetup") {
        return (await page.locator('a[href*="login"]').count()) === 0;
      }
      return (await page.getByText("Sign In").count()) === 0;
    } catch {
      // Page may be mid-navigation; let the caller poll again.
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

  /**
   * Clear saved session for a platform.
   *
   * Acquires the mutex to avoid closing a context that another
   * tool call is actively using.
   */
  async clearSession(platform: Platform): Promise<void> {
    await this.mutex.acquire();
    try {
      const sessionFile = this.sessionPath(platform);
      if (existsSync(sessionFile)) {
        await rm(sessionFile);
      }

      const context = this.contexts.get(platform);
      if (context) {
        await context.close();
        this.contexts.delete(platform);
      }
    } finally {
      this.mutex.release();
    }
  }

  /**
   * Launch a Chrome instance with the automation fingerprint suppressed.
   *
   * Uses the system-installed Google Chrome (`channel: "chrome"`) and
   * disables the AutomationControlled blink feature, which together strip
   * the `navigator.webdriver` signal sites like Google use to reject
   * automated browsers ("this browser or app may not be secure"). Falls
   * back to Playwright's bundled Chromium if Chrome isn't installed.
   */
  private async launchStealth(headless: boolean): Promise<Browser> {
    const args = ["--disable-blink-features=AutomationControlled"];
    try {
      return await chromium.launch({ headless, channel: "chrome", args });
    } catch {
      return await chromium.launch({ headless, args });
    }
  }

  /** Mutex-guarded teardown of a platform's live context, flushing first. */
  private async closeExistingContext(platform: Platform): Promise<void> {
    await this.mutex.acquire();
    try {
      const existing = this.contexts.get(platform);
      if (existing) {
        await this.saveSession(platform);
        await existing.close();
        this.contexts.delete(platform);
      }
    } finally {
      this.mutex.release();
    }
  }

  /**
   * Open a visible browser for the user to log in manually.
   * Saves the session once they're done.
   *
   * Acquires the mutex before touching the context map so an
   * in-flight tool call isn't left with a closed context.
   * The mutex is released before the 5-minute login wait so
   * other platforms can still be used while the user logs in.
   */
  async interactiveLogin(platform: Platform): Promise<string> {
    await this.closeExistingContext(platform);

    // Headed (visible) browser the user signs into manually. Separate
    // instance, so the mutex isn't needed during the long login wait.
    const headedBrowser = await this.launchStealth(false);
    const context = await headedBrowser.newContext();
    const page = await context.newPage();

    await page.goto(PLATFORM_URLS[platform]);

    // Wait for the user to *complete* login — i.e. be back on the platform's
    // own domain with the logged-out marker gone. We poll rather than watch
    // for "navigated away from start", because an OAuth flow (Sign in with
    // Google) navigates away immediately to the provider; treating that first
    // hop as success would save an un-authenticated session and close the
    // window mid-login. Re-confirm after a short settle so a transient match
    // during a redirect doesn't fire early.
    const deadline = Date.now() + 300_000; // 5 minutes to log in
    let loggedIn = false;
    while (Date.now() < deadline) {
      await page.waitForTimeout(1000).catch(() => {});
      if (page.isClosed()) break;
      if (await this.pageShowsLoggedIn(page, platform)) {
        await page.waitForTimeout(2000).catch(() => {});
        if (!page.isClosed() && (await this.pageShowsLoggedIn(page, platform))) {
          loggedIn = true;
          break;
        }
      }
    }

    if (!loggedIn) {
      await headedBrowser.close();
      return (
        "Login not detected within 5 minutes — nothing was saved. " +
        "Run `events login` again and complete sign-in (including any OAuth/2FA)."
      );
    }

    // Save the authenticated session
    const state = await context.storageState();
    await writeFile(
      this.sessionPath(platform),
      JSON.stringify(state, null, 2)
    );

    await headedBrowser.close();

    // Reset validation so the new session gets checked on next use
    this.validated.delete(platform);

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
