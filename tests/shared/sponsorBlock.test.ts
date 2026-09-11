// The sponsor-skip policy: which raw SponsorBlock entries become skippable
// segments, and which segment (if any) the player must jump past at a given
// playback position. See src/shared/sponsorBlock.ts.

import { describe, expect, it } from "vitest";
import {
  normalizeSponsorSegments,
  sponsorSegmentToSkip,
  type SponsorSegment,
} from "../../src/shared/sponsorBlock";

describe("normalizeSponsorSegments", () => {
  it("keeps sponsor and selfpromo segments with actionType skip", () => {
    const segments = normalizeSponsorSegments([
      { category: "sponsor", actionType: "skip", segment: [10, 20] },
      { category: "selfpromo", actionType: "skip", segment: [30, 40] },
    ]);
    expect(segments).toEqual([
      { category: "sponsor", startSeconds: 10, endSeconds: 20 },
      { category: "selfpromo", startSeconds: 30, endSeconds: 40 },
    ]);
  });

  it("drops action types that are not a skip", () => {
    const segments = normalizeSponsorSegments([
      { category: "sponsor", actionType: "mute", segment: [10, 20] },
      { category: "sponsor", actionType: "poi", segment: [30, 31] },
      { category: "sponsor", actionType: "full", segment: [0, 100] },
    ]);
    expect(segments).toEqual([]);
  });

  it("drops categories the player does not skip", () => {
    const segments = normalizeSponsorSegments([
      { category: "interaction", actionType: "skip", segment: [10, 20] },
      { category: "music_offtopic", actionType: "skip", segment: [30, 40] },
    ]);
    expect(segments).toEqual([]);
  });

  it("drops malformed, zero-length and negative segments", () => {
    const segments = normalizeSponsorSegments([
      { category: "sponsor", actionType: "skip", segment: [10, 10] },
      { category: "sponsor", actionType: "skip", segment: [40, 30] },
      { category: "sponsor", actionType: "skip", segment: [-5, 20] },
      { category: "sponsor", actionType: "skip", segment: [10] },
      { category: "sponsor", actionType: "skip" },
      { category: "sponsor", actionType: "skip", segment: ["a", "b"] },
      null,
      "nonsense",
    ]);
    expect(segments).toEqual([]);
  });

  it("sorts segments by start time", () => {
    const segments = normalizeSponsorSegments([
      { category: "sponsor", actionType: "skip", segment: [90, 100] },
      { category: "sponsor", actionType: "skip", segment: [10, 20] },
    ]);
    expect(segments.map((segment) => segment.startSeconds)).toEqual([10, 90]);
  });

  it("merges overlapping and touching segments into one", () => {
    const segments = normalizeSponsorSegments([
      { category: "sponsor", actionType: "skip", segment: [10, 30] },
      { category: "selfpromo", actionType: "skip", segment: [25, 50] },
      { category: "sponsor", actionType: "skip", segment: [50, 60] },
      { category: "sponsor", actionType: "skip", segment: [120, 130] },
    ]);
    expect(segments).toEqual([
      { category: "sponsor", startSeconds: 10, endSeconds: 60 },
      { category: "sponsor", startSeconds: 120, endSeconds: 130 },
    ]);
  });

  it("returns an empty list for anything that is not an array", () => {
    expect(normalizeSponsorSegments(undefined)).toEqual([]);
    expect(normalizeSponsorSegments(null)).toEqual([]);
    expect(normalizeSponsorSegments({})).toEqual([]);
  });
});

describe("sponsorSegmentToSkip", () => {
  const segments: SponsorSegment[] = [
    { category: "sponsor", startSeconds: 10, endSeconds: 20 },
    { category: "selfpromo", startSeconds: 60, endSeconds: 75 },
  ];

  it("returns the segment that contains the position", () => {
    expect(sponsorSegmentToSkip(segments, 12, [])).toEqual(segments[0]);
    expect(sponsorSegmentToSkip(segments, 74.5, [])).toEqual(segments[1]);
  });

  it("returns null outside every segment", () => {
    expect(sponsorSegmentToSkip(segments, 5, [])).toBeNull();
    expect(sponsorSegmentToSkip(segments, 20, [])).toBeNull();
    expect(sponsorSegmentToSkip(segments, 100, [])).toBeNull();
  });

  it("returns null for a segment the viewer undid", () => {
    expect(sponsorSegmentToSkip(segments, 12, [10])).toBeNull();
    expect(sponsorSegmentToSkip(segments, 62, [10])).toEqual(segments[1]);
  });

  it("returns null for an unusable position or an empty list", () => {
    expect(sponsorSegmentToSkip(segments, Number.NaN, [])).toBeNull();
    expect(sponsorSegmentToSkip([], 12, [])).toBeNull();
  });
});
