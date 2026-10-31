import { defineConfig } from "vitest/config";

// Tests run in Node against the real server code, with the Google Apps Script
// runtime globals replaced by in-memory fakes (tests/helpers/appsScriptMock.ts).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // The list calls log one stage-timing line each (src/server/timing.ts).
    // Tests that care spy on console.log; everywhere else the line is noise.
    onConsoleLog: (log: string): boolean | void =>
      /^get\w+ \d+ms/.test(log) ? false : undefined,
  },
});
