import { describe, it, expect } from "vitest";
import {
  DEFAULT_FEED_BEFORE_MONTHS,
  defaultFeedBeforeDate,
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

describe("defaultFeedBeforeDate", () => {
  it("is three months before the given date", () => {
    expect(DEFAULT_FEED_BEFORE_MONTHS).toBe(3);
    expect(defaultFeedBeforeDate(new Date(2026, 6, 4))).toBe("2026-04-04");
  });
});
