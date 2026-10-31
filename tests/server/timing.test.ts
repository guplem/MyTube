// The stage stopwatch behind the timing line that the slow server calls write
// to the Apps Script execution log. See src/server/timing.ts.

import { describe, expect, it } from "vitest";
import { startStopwatch } from "../../src/server/timing";

/** A clock that returns these times in order, then repeats the last one. */
function clock(times: number[]): () => number {
  let index = 0;
  return (): number => times[Math.min(index++, times.length - 1)];
}

describe("startStopwatch", () => {
  it("times each stage from the end of the stage before it", () => {
    const watch = startStopwatch(
      "getFeedPage",
      clock([1000, 1250, 1300, 2000]),
    );
    watch.lap("feed", "12 channels fetched");
    watch.lap("flags");
    expect(watch.summary()).toBe(
      "getFeedPage 1000ms | feed 250ms (12 channels fetched) | flags 50ms",
    );
  });

  it("reports only the total when no stage was timed", () => {
    const watch = startStopwatch("getWatchLaterVideos", clock([0, 40]));
    expect(watch.summary()).toBe("getWatchLaterVideos 40ms");
  });
});
