import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/index.ts",       // MCP server wiring — no logic to test
        "src/tools/**",       // Playwright automation — needs integration tests
      ],
      thresholds: {
        // Pure logic modules — fully testable
        "src/mutex.ts": {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
        // Browser manager — partially testable (withBrowser, saveSession),
        // but interactive login, session validation, and shutdown need
        // a real browser. Raise this as we add integration tests.
        "src/browser.ts": {
          lines: 30,
          functions: 40,
          branches: 25,
          statements: 30,
        },
      },
    },
  },
});
