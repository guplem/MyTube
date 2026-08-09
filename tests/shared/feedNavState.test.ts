// What the Feed nav button shows: pulsing while a first page is in flight, dimmed
// until the session has loaded one, then a blue dot only while that page still
// has videos on it.

import { describe, it, expect } from "vitest";
import { feedNavState } from "../../src/shared/feedNavState";

describe("feedNavState", () => {
  it("is loading while the first page is still in flight", () => {
    expect(feedNavState(null, true)).toBe("loading");
  });

  // The whole point of splitting loading out of pending: a load that failed is
  // not a load in progress, so it must fall back to the still look. A pulse that
  // never stops would promise a page that is never coming.
  it("is pending when nothing loaded and no load is in flight", () => {
    expect(feedNavState(null, false)).toBe("pending");
  });

  // A refresh behind an already loaded page must not take the button back to
  // loading: the last total is still the truth on screen, and flipping the dot
  // off and on again would make it blink all session.
  it("keeps reporting the loaded page while a later load is in flight", () => {
    expect(feedNavState(5, true)).toBe("waiting");
    expect(feedNavState(0, true)).toBe("empty");
  });

  it("waits once a loaded page has videos left after the filters", () => {
    expect(feedNavState(5, false)).toBe("waiting");
  });

  // The boundary between waiting and empty. Without this, tightening the rule to
  // "more than one" would pass every other test while the last video in an inbox
  // silently lost its dot.
  it("still waits on the last remaining video", () => {
    expect(feedNavState(1, false)).toBe("waiting");
  });

  // The dim says "nothing has loaded yet", never "the feed is empty". An emptied
  // inbox is a loaded feed, so it must look loaded and carry no dot.
  it("is empty once a loaded page has no videos left", () => {
    expect(feedNavState(0, false)).toBe("empty");
  });
});
