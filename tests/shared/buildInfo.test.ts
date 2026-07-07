// The footer's deploy-stamp formatter: how the build moment injected by
// build.mjs is rendered at the bottom of every screen. See src/shared/buildInfo.ts.

import { describe, expect, it } from "vitest";
import { formatBuildTimestamp } from "../../src/shared/buildInfo";

describe("formatBuildTimestamp", () => {
  it("formats an ISO timestamp as a local YYYY-MM-DD HH:MM string", () => {
    // Build the input from local date parts so the expectation holds in any
    // timezone: toISOString() converts to UTC and the formatter converts back.
    const local = new Date(2026, 6, 7, 14, 32, 59);
    expect(formatBuildTimestamp(local.toISOString())).toBe("2026-07-07 14:32");
  });

  it("zero-pads month, day, hour, and minute", () => {
    const local = new Date(2026, 0, 3, 4, 7);
    expect(formatBuildTimestamp(local.toISOString())).toBe("2026-01-03 04:07");
  });

  it("returns an empty string for an unparseable timestamp", () => {
    expect(formatBuildTimestamp("not a date")).toBe("");
  });

  it("returns an empty string for an empty timestamp", () => {
    expect(formatBuildTimestamp("")).toBe("");
  });
});
