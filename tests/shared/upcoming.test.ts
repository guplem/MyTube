// An announced video (a scheduled premiere or live stream) is listed before it
// is out. These tests pin how the Data API's liveStreamingDetails turn into
// "upcoming", how long the shared cache keeps that answer, and the card label.

import { describe, expect, it } from "vitest";
import {
  scheduledStartOf,
  videoLengthCacheSeconds,
  upcomingLabel,
} from "../../src/shared/upcoming";

const NOW_MS: number = Date.parse("2026-10-31T12:00:00Z");

describe("scheduledStartOf", (): void => {
  it("returns the scheduled start while the video has not started", (): void => {
    expect(
      scheduledStartOf({ scheduledStartTime: "2026-10-31T19:00:00Z" }),
    ).toBe("2026-10-31T19:00:00Z");
  });

  it("returns undefined once the stream or premiere has started", (): void => {
    expect(
      scheduledStartOf({
        scheduledStartTime: "2026-10-31T11:00:00Z",
        actualStartTime: "2026-10-31T11:02:00Z",
      }),
    ).toBeUndefined();
  });

  it("returns undefined for a normal upload", (): void => {
    expect(scheduledStartOf(undefined)).toBeUndefined();
    expect(scheduledStartOf({})).toBeUndefined();
  });
});

describe("videoLengthCacheSeconds", (): void => {
  it("keeps a normal upload for the full 6 hours", (): void => {
    expect(videoLengthCacheSeconds(undefined, NOW_MS)).toBe(21600);
  });

  it("keeps a finished premiere or stream for the full 6 hours", (): void => {
    expect(
      videoLengthCacheSeconds(
        {
          scheduledStartTime: "2026-10-30T19:00:00Z",
          actualStartTime: "2026-10-30T19:00:00Z",
          actualEndTime: "2026-10-30T20:00:00Z",
        },
        NOW_MS,
      ),
    ).toBe(21600);
  });

  it("keeps an upcoming video until its scheduled start", (): void => {
    expect(
      videoLengthCacheSeconds(
        { scheduledStartTime: "2026-10-31T15:00:00Z" },
        NOW_MS,
      ),
    ).toBe(3 * 3600);
  });

  it("caps a far-off start at 6 hours", (): void => {
    expect(
      videoLengthCacheSeconds(
        { scheduledStartTime: "2026-11-05T15:00:00Z" },
        NOW_MS,
      ),
    ).toBe(21600);
  });

  it("asks again after 5 minutes when the start is late or close", (): void => {
    expect(
      videoLengthCacheSeconds(
        { scheduledStartTime: "2026-10-31T11:00:00Z" },
        NOW_MS,
      ),
    ).toBe(300);
    expect(
      videoLengthCacheSeconds(
        { scheduledStartTime: "2026-10-31T12:01:00Z" },
        NOW_MS,
      ),
    ).toBe(300);
  });

  it("asks again after 5 minutes while the video is live", (): void => {
    expect(
      videoLengthCacheSeconds(
        {
          scheduledStartTime: "2026-10-31T11:00:00Z",
          actualStartTime: "2026-10-31T11:00:00Z",
        },
        NOW_MS,
      ),
    ).toBe(300);
  });
});

describe("upcomingLabel", (): void => {
  const now: Date = new Date(2026, 9, 31, 12, 0);

  it("names the scheduled date and time", (): void => {
    const start: string = new Date(2026, 9, 31, 20, 0).toISOString();
    expect(upcomingLabel(start, now, "en-GB")).toBe("Upcoming · 31 Oct, 20:00");
  });

  it("says the start is close once the scheduled time is near or past", (): void => {
    const soon: string = new Date(2026, 9, 31, 12, 3).toISOString();
    const late: string = new Date(2026, 9, 31, 11, 30).toISOString();
    expect(upcomingLabel(soon, now, "en-GB")).toBe("Starting soon");
    expect(upcomingLabel(late, now, "en-GB")).toBe("Starting soon");
  });
});
