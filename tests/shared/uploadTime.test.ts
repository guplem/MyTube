// The upload time on cards and in the player: relative for today, "Yesterday
// at HH:MM" for yesterday, a date and time before that. Dates are built from
// local parts, so the tests hold in any time zone.

import { describe, expect, it } from "vitest";
import { formatUploadTime } from "../../src/shared/uploadTime";

const NOW: Date = new Date(2026, 9, 31, 12, 0); // Oct 31 2026, 12:00 local

function at(
  month: number,
  day: number,
  hour: number,
  minute: number,
  year: number = 2026,
): string {
  return new Date(year, month, day, hour, minute).toISOString();
}

describe("formatUploadTime", (): void => {
  it("counts minutes in the first hour", (): void => {
    expect(formatUploadTime(at(9, 31, 11, 35), NOW, "en-GB")).toBe("25m ago");
  });

  it("says just now under a minute", (): void => {
    expect(formatUploadTime(at(9, 31, 12, 0), NOW, "en-GB")).toBe("Just now");
  });

  it("counts hours for the rest of today", (): void => {
    expect(formatUploadTime(at(9, 31, 7, 0), NOW, "en-GB")).toBe("5h ago");
    expect(formatUploadTime(at(9, 31, 0, 5), NOW, "en-GB")).toBe("11h ago");
  });

  it("says yesterday with the time for the day before, even under 24 hours", (): void => {
    expect(formatUploadTime(at(9, 30, 18, 40), NOW, "en-GB")).toBe(
      "Yesterday at 18:40",
    );
    expect(formatUploadTime(at(9, 30, 23, 59), NOW, "en-GB")).toBe(
      "Yesterday at 23:59",
    );
  });

  it("gives date and time before yesterday, in the browser's locale", (): void => {
    expect(formatUploadTime(at(9, 29, 21, 15), NOW, "en-GB")).toBe(
      "29 Oct, 21:15",
    );
    expect(formatUploadTime(at(9, 29, 21, 15), NOW, "en-US")).toBe(
      "Oct 29, 9:15 PM",
    );
  });

  it("adds the year for another year", (): void => {
    expect(formatUploadTime(at(11, 24, 9, 30, 2025), NOW, "en-GB")).toBe(
      "24 Dec 2025, 9:30",
    );
  });

  it("returns an empty string for a date it cannot read", (): void => {
    expect(formatUploadTime("not a date", NOW, "en-GB")).toBe("");
  });

  it("treats a time a little in the future (clock skew) as just now", (): void => {
    expect(formatUploadTime(at(9, 31, 12, 3), NOW, "en-GB")).toBe("Just now");
  });
});
