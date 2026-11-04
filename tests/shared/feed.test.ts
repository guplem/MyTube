import { describe, it, expect } from "vitest";
import {
  DEFAULT_FEED_MAX_AGE,
  FEED_MAX_AGE_OPTIONS,
  feedCutoffDate,
  monthsAgoIso,
} from "../../src/shared/feed";

describe("monthsAgoIso", () => {
  it("returns the date the given number of months earlier as YYYY-MM-DD", () => {
    expect(monthsAgoIso(new Date(2026, 6, 4), 3)).toBe("2026-04-04");
  });

  it("crosses the year boundary", () => {
    expect(monthsAgoIso(new Date(2026, 1, 15), 3)).toBe("2025-11-15");
  });

  it("clamps the day to the target month's length instead of overflowing", () => {
    // 3 months before May 31 is the last day of February, not March 3.
    expect(monthsAgoIso(new Date(2026, 4, 31), 3)).toBe("2026-02-28");
    // Leap year: February has 29 days.
    expect(monthsAgoIso(new Date(2024, 4, 31), 3)).toBe("2024-02-29");
  });

  it("zero-pads month and day", () => {
    expect(monthsAgoIso(new Date(2026, 2, 5), 0)).toBe("2026-03-05");
  });
});

describe("feedCutoffDate", () => {
  it("defaults to three months", () => {
    expect(DEFAULT_FEED_MAX_AGE).toBe("3m");
    expect(feedCutoffDate(new Date(2026, 6, 4), DEFAULT_FEED_MAX_AGE)).toBe(
      "2026-04-04",
    );
  });

  it("rolls forward with today: the stored value is an age, not a date", () => {
    expect(feedCutoffDate(new Date(2026, 6, 4), "3m")).toBe("2026-04-04");
    expect(feedCutoffDate(new Date(2026, 6, 5), "3m")).toBe("2026-04-05");
  });

  it("counts week options in days", () => {
    expect(feedCutoffDate(new Date(2026, 2, 3), "1w")).toBe("2026-02-24");
    expect(feedCutoffDate(new Date(2026, 2, 3), "2w")).toBe("2026-02-17");
  });

  it("counts the year option in months", () => {
    expect(feedCutoffDate(new Date(2026, 6, 4), "1y")).toBe("2025-07-04");
  });

  it("falls back to the default for an unknown stored value", () => {
    // A value from an older build, or a hand-edited store, must not lift the
    // cutoff: the feed is always bounded.
    expect(feedCutoffDate(new Date(2026, 6, 4), "2026-06-08")).toBe(
      "2026-04-04",
    );
    expect(feedCutoffDate(new Date(2026, 6, 4), "")).toBe("2026-04-04");
  });

  it("offers the default among its options, each with a label", () => {
    const ids: string[] = FEED_MAX_AGE_OPTIONS.map((option) => option.id);
    expect(ids).toContain(DEFAULT_FEED_MAX_AGE);
    expect(new Set(ids).size).toBe(ids.length);
    for (const option of FEED_MAX_AGE_OPTIONS) {
      expect(option.label).not.toBe("");
    }
  });
});
