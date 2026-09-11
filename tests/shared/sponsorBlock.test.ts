// The sponsor-skip policy: which raw SponsorBlock entries become skippable
// segments, and which segment (if any) the player must jump past at a given
// playback position. See src/shared/sponsorBlock.ts.

import { describe, expect, it } from "vitest";
import {
  normalizeSponsorSegments,
  sponsorCategoryLabel,
  sponsorSkipDecision,
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

  it("drops a segment that ends past the video duration", () => {
    const segments = normalizeSponsorSegments(
      [
        { category: "sponsor", actionType: "skip", segment: [0, 99999] },
        { category: "sponsor", actionType: "skip", segment: [10, 20] },
      ],
      600,
    );
    expect(segments).toEqual([
      { category: "sponsor", startSeconds: 10, endSeconds: 20 },
    ]);
  });

  it("keeps a segment that ends exactly at the video duration", () => {
    const segments = normalizeSponsorSegments(
      [{ category: "sponsor", actionType: "skip", segment: [10, 600] }],
      600,
    );
    expect(segments).toHaveLength(1);
  });

  it("applies no upper bound when the duration is unknown", () => {
    const raw = [
      { category: "sponsor", actionType: "skip", segment: [0, 99999] },
    ];
    expect(normalizeSponsorSegments(raw)).toHaveLength(1);
    expect(normalizeSponsorSegments(raw, undefined)).toHaveLength(1);
    expect(normalizeSponsorSegments(raw, 0)).toHaveLength(1);
  });
});

describe("sponsorSkipDecision", () => {
  const segments: SponsorSegment[] = [
    { category: "sponsor", startSeconds: 10, endSeconds: 20 },
    { category: "selfpromo", startSeconds: 60, endSeconds: 75 },
  ];

  it("returns the segment that contains the position", () => {
    expect(sponsorSkipDecision(segments, 12, [], null)).toEqual({
      segment: segments[0],
      lastSkippedStartSeconds: 10,
    });
    expect(sponsorSkipDecision(segments, 74.5, [], null)).toEqual({
      segment: segments[1],
      lastSkippedStartSeconds: 60,
    });
  });

  it("returns no segment outside every segment, and clears the memory", () => {
    for (const position of [5, 20, 100]) {
      expect(sponsorSkipDecision(segments, position, [], 10)).toEqual({
        segment: null,
        lastSkippedStartSeconds: null,
      });
    }
  });

  it("returns no segment for one the viewer undid", () => {
    expect(sponsorSkipDecision(segments, 12, [10], null).segment).toBeNull();
    expect(sponsorSkipDecision(segments, 62, [10], null).segment).toEqual(
      segments[1],
    );
  });

  it("does not jump the same segment twice, and does not clear the memory", () => {
    // The reported bug: the viewer rewinds into a segment already jumped, and
    // the player must leave that rewind alone.
    expect(sponsorSkipDecision(segments, 12, [], 10)).toEqual({
      segment: null,
      lastSkippedStartSeconds: 10,
    });
  });

  it("jumps the segment again after the position left it", () => {
    const outside = sponsorSkipDecision(segments, 30, [], 10);
    expect(outside.lastSkippedStartSeconds).toBeNull();
    expect(
      sponsorSkipDecision(segments, 12, [], outside.lastSkippedStartSeconds),
    ).toEqual({ segment: segments[0], lastSkippedStartSeconds: 10 });
  });

  it("keeps the memory for an unreadable position", () => {
    // A position the player cannot report is not a position outside every
    // segment, so it must not clear the memory.
    expect(sponsorSkipDecision(segments, Number.NaN, [], 10)).toEqual({
      segment: null,
      lastSkippedStartSeconds: 10,
    });
  });

  it("returns no segment for an empty list", () => {
    expect(sponsorSkipDecision([], 12, [], null)).toEqual({
      segment: null,
      lastSkippedStartSeconds: null,
    });
  });
});

describe("sponsorCategoryLabel", () => {
  it("names each category the player skips", () => {
    expect(sponsorCategoryLabel("sponsor")).toBe("sponsor");
    expect(sponsorCategoryLabel("selfpromo")).toBe("self-promotion");
  });
});
