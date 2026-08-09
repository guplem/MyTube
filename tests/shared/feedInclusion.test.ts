// Whether a video the feed already loaded still belongs there after the user
// changed one of its flags, and what that leaves the feed's total at. This is
// what makes the Feed nav dot disappear the moment the last waiting video is
// dealt with, instead of waiting for a page reload.

import { describe, it, expect } from "vitest";
import {
  belongsInFeed,
  remainingFeedTotal,
  type FeedFlagFilters,
  type FeedVideoFlags,
} from "../../src/shared/feedInclusion";

const ALL_ON: FeedFlagFilters = {
  hideViewed: true,
  hideDismissed: true,
  hideSaved: true,
};
const ALL_OFF: FeedFlagFilters = {
  hideViewed: false,
  hideDismissed: false,
  hideSaved: false,
};

function video(flags: Partial<FeedVideoFlags> = {}): FeedVideoFlags {
  return { seen: false, dismissed: false, inWatchLater: false, ...flags };
}

describe("belongsInFeed", () => {
  it("keeps an untouched video", () => {
    expect(belongsInFeed(video(), ALL_ON)).toBe(true);
  });

  it("drops a video whose flag its filter hides", () => {
    expect(belongsInFeed(video({ seen: true }), ALL_ON)).toBe(false);
    expect(belongsInFeed(video({ dismissed: true }), ALL_ON)).toBe(false);
    expect(belongsInFeed(video({ inWatchLater: true }), ALL_ON)).toBe(false);
  });

  // The flag alone never drops a video: with the filter off the feed still shows
  // it, so the total must not move either. "Hide watched" is off by default, so
  // this is the common case, not an edge one.
  it("keeps a flagged video while its filter is off", () => {
    expect(belongsInFeed(video({ seen: true }), ALL_OFF)).toBe(true);
    expect(belongsInFeed(video({ dismissed: true }), ALL_OFF)).toBe(true);
    expect(belongsInFeed(video({ inWatchLater: true }), ALL_OFF)).toBe(true);
  });

  // Flags are optional on Video (dismissed is set on feed videos only, and
  // membership only where it was looked up), so absent must read as false.
  it("treats a missing flag as not set", () => {
    expect(belongsInFeed({ seen: false }, ALL_ON)).toBe(true);
  });
});

describe("remainingFeedTotal", () => {
  // The page is a slice: the total counts videos we do not hold, so it is
  // corrected by a delta, never recomputed from the page's length.
  it("subtracts only the videos on the page that no longer belong", () => {
    const page = [video(), video({ seen: true }), video({ dismissed: true })];
    expect(remainingFeedTotal(40, page, ALL_ON)).toBe(38);
  });

  it("leaves the total alone while every video still belongs", () => {
    expect(remainingFeedTotal(40, [video(), video()], ALL_ON)).toBe(40);
  });

  // The badge's whole point: dealing with the last video must reach exactly 0,
  // which is what turns the dot off.
  it("reaches zero when the last waiting video is dealt with", () => {
    expect(remainingFeedTotal(1, [video({ dismissed: true })], ALL_ON)).toBe(0);
  });

  // A video counted twice (say a mutation that flips two flags at once) must not
  // push the badge below empty; "empty" is the floor the nav button understands.
  it("never goes below zero", () => {
    expect(
      remainingFeedTotal(
        1,
        [video({ seen: true }), video({ seen: true })],
        ALL_ON,
      ),
    ).toBe(0);
  });
});
