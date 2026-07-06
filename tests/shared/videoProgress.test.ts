// The resume-position policy: which playback positions are worth storing and
// which mean "start over next time". See src/shared/videoProgress.ts.

import { describe, expect, it } from "vitest";
import { progressFraction, progressToStore } from "../../src/shared/videoProgress";

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

describe("progressFraction", () => {
  it("returns the watched fraction of the video", () => {
    expect(progressFraction(150, 600)).toBe(0.25);
  });

  it("returns null when there is no stored progress", () => {
    expect(progressFraction(undefined, 600)).toBeNull();
    expect(progressFraction(0, 600)).toBeNull();
  });

  it("returns null when the duration is unknown", () => {
    // Duration lookup is best-effort; without it there is nothing to divide by.
    expect(progressFraction(150, undefined)).toBeNull();
    expect(progressFraction(150, 0)).toBeNull();
  });

  it("clamps a position past the duration to a full bar", () => {
    // A stale or rounded position must never overflow the thumbnail.
    expect(progressFraction(700, 600)).toBe(1);
  });
});
