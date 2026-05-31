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
        // The login flows (interactive OAuth, credential login), live session
        // validation, and shutdown all drive a real browser and need
        // integration tests; that untested-but-necessary glue is the bulk of
        // the file, so the floor is low by design. Raise it as integration
        // coverage lands.
        "src/browser.ts": {
          lines: 24,
          functions: 30,
          branches: 17,
          statements: 24,
        },
      },
    },
  },
});
