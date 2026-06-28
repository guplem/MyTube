import { defineConfig } from "vitest/config";

// Tests run in Node against the real server code, with the Google Apps Script
// runtime globals replaced by in-memory fakes (tests/helpers/appsScriptMock.ts).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
