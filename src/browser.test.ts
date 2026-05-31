import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Playwright and fs before importing browser module ───────────

const mockPage = {
  close: vi.fn().mockResolvedValue(undefined),
  goto: vi.fn().mockResolvedValue(undefined),
  locator: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
  getByText: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
};

const mockStorageState = vi.fn().mockResolvedValue({ cookies: [], origins: [] });

const mockContext = {
  newPage: vi.fn().mockResolvedValue(mockPage),
  storageState: mockStorageState,
  close: vi.fn().mockResolvedValue(undefined),
};

const mockBrowser = {
  isConnected: vi.fn().mockReturnValue(true),
  newContext: vi.fn().mockResolvedValue(mockContext),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue(mockBrowser),
  },
}));

vi.mock("fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue("{}"),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

const { browser, isLoggedInUrl } = await import("./browser.js");

describe("BrowserManager.withBrowser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-stub after clear so the mock chain stays intact
    mockContext.newPage.mockResolvedValue(mockPage);
    mockContext.storageState.mockResolvedValue({ cookies: [], origins: [] });
    mockBrowser.newContext.mockResolvedValue(mockContext);
    mockBrowser.isConnected.mockReturnValue(true);
  });

  it("closes the page and saves session after callback completes", async () => {
    const result = await browser.withBrowser("meetup", async () => {
      return "done";
    });

    expect(result).toBe("done");
    expect(mockPage.close).toHaveBeenCalledOnce();
    expect(mockStorageState).toHaveBeenCalledOnce();
  });

  it("closes the page and saves session even when callback throws", async () => {
    await expect(
      browser.withBrowser("meetup", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // Cleanup still happened
    expect(mockPage.close).toHaveBeenCalledOnce();
    expect(mockStorageState).toHaveBeenCalledOnce();
  });

  it("serialises concurrent calls — no interleaving", async () => {
    const log: string[] = [];

    async function work(id: string) {
      return browser.withBrowser("luma", async () => {
        log.push(`${id}:start`);
        await new Promise((r) => setTimeout(r, 5));
        log.push(`${id}:end`);
        return id;
      });
    }

    const [a, b, c] = await Promise.all([work("a"), work("b"), work("c")]);

    expect(a).toBe("a");
    expect(b).toBe("b");
    expect(c).toBe("c");

    // Each worker's start/end should be contiguous — no interleaving
    expect(log).toEqual([
      "a:start", "a:end",
      "b:start", "b:end",
      "c:start", "c:end",
    ]);
  });

  it("does not deadlock the mutex after an error", async () => {
    // First call throws
    await expect(
      browser.withBrowser("meetup", async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");

    // Second call should still work (mutex was released)
    const result = await browser.withBrowser("meetup", async () => "ok");
    expect(result).toBe("ok");
  });
});

describe("isLoggedInUrl", () => {
  it("accepts the platform's own domain off any non-login path", () => {
    expect(isLoggedInUrl("https://www.meetup.com/home/", "meetup")).toBe(true);
    expect(isLoggedInUrl("https://www.meetup.com/some-group/events/123/", "meetup")).toBe(true);
    expect(isLoggedInUrl("https://lu.ma/home", "luma")).toBe(true);
  });

  it("rejects login/signup paths (the false-positive that clobbered a session)", () => {
    expect(isLoggedInUrl("https://www.meetup.com/login/", "meetup")).toBe(false);
    expect(isLoggedInUrl("https://www.meetup.com/signup", "meetup")).toBe(false);
    expect(isLoggedInUrl("https://lu.ma/signin", "luma")).toBe(false);
  });

  it("rejects third-party OAuth provider domains mid-sign-in", () => {
    expect(isLoggedInUrl("https://accounts.google.com/o/oauth2/v2/auth", "meetup")).toBe(false);
    expect(isLoggedInUrl("https://appleid.apple.com/auth/authorize", "meetup")).toBe(false);
  });

  it("rejects the wrong platform's domain", () => {
    expect(isLoggedInUrl("https://lu.ma/home", "meetup")).toBe(false);
    expect(isLoggedInUrl("https://www.meetup.com/home/", "luma")).toBe(false);
  });

  it("rejects a malformed URL", () => {
    expect(isLoggedInUrl("not a url", "meetup")).toBe(false);
    expect(isLoggedInUrl("", "luma")).toBe(false);
  });
});
