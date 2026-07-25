// What the Feed nav button shows: dimmed until the session has loaded a feed
// page, then a blue dot only while that page still has videos on it.

import { describe, it, expect } from "vitest";
import { feedNavState } from "../../src/shared/feedNavState";

describe("feedNavState", () => {
  it("is pending before any feed page has loaded", () => {
    expect(feedNavState(null)).toBe("pending");
  });

  it("waits once a loaded page has videos left after the filters", () => {
    expect(feedNavState(5)).toBe("waiting");
  });

  // The dim says "nothing has loaded yet", never "the feed is empty". An emptied
  // inbox is a loaded feed, so it must look loaded and carry no dot.
  it("is empty once a loaded page has no videos left", () => {
    expect(feedNavState(0)).toBe("empty");
  });
});
