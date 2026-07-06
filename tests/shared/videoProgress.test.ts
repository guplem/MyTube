// The resume-position policy: which playback positions are worth storing and
// which mean "start over next time". See src/shared/videoProgress.ts.

import { describe, expect, it } from "vitest";
import { progressToStore } from "../../src/shared/videoProgress";

describe("progressToStore", () => {
  it("stores a mid-video position, rounded down to whole seconds", () => {
    expect(progressToStore(125.7, 600)).toBe(125);
  });

  it("returns 0 (clear) for a position in the first seconds of the video", () => {
    expect(progressToStore(8, 600)).toBe(0);
  });

  it("returns 0 (clear) when the video is effectively finished", () => {
    expect(progressToStore(590, 600)).toBe(0);
  });

  it("stores a position just before the effectively-finished window", () => {
    expect(progressToStore(500, 600)).toBe(500);
  });

  it("stores a qualifying position even when the duration is unknown", () => {
    // The IFrame API reports duration 0 until metadata loads.
    expect(progressToStore(120, 0)).toBe(120);
  });

  it("returns 0 for a non-finite position", () => {
    expect(progressToStore(Number.NaN, 600)).toBe(0);
    expect(progressToStore(Number.POSITIVE_INFINITY, 600)).toBe(0);
  });

  it("treats a short video's end as finished, not resumable", () => {
    // 95% of a 60s video is 57s; anything at or past it clears.
    expect(progressToStore(58, 60)).toBe(0);
  });
});
