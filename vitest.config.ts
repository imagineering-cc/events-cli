import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/cli.ts",         // CLI entry/dispatch — covered via args.ts unit tests
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
        // CLI argument parsing — pure, schema-driven, fully testable
        "src/cli/args.ts": {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
        // Browser manager — only the non-driving logic is unit-testable here
        // (mutex/withBrowser/saveSession, plus the pure isLoggedInUrl guard).
        // Interactive login, live session validation, and shutdown drive a
        // real browser and need integration tests. Raise as that coverage lands.
        "src/browser.ts": {
          lines: 30,
          functions: 40,
          branches: 24,
          statements: 30,
        },
      },
    },
  },
});
