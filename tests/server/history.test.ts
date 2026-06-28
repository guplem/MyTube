// Watch history persistence in PropertiesService: dedupe, newest-first ordering,
// the MAX_ENTRIES cap, removal, and the chunk split/join that keeps each stored
// value under the ~9KB-per-property limit. See ADR 0005 and history.ts.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installAppsScriptMocks, uninstallAppsScriptMocks } from "../helpers/appsScriptMock";
import { makeVideo } from "../helpers/fixtures";
import {
  getHistory,
  getSeenVideoIds,
  markVideoSeen,
  removeVideoSeen,
} from "../../src/server/history";

beforeEach(() => {
  installAppsScriptMocks();
});
afterEach(() => {
  uninstallAppsScriptMocks();
});

describe("watch history", () => {
  it("records a video and returns it as seen", () => {
    markVideoSeen(makeVideo({ videoId: "a", title: "A" }));

    expect(getSeenVideoIds()).toEqual(["a"]);
    const history = getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].videoId).toBe("a");
    expect(history[0].seen).toBe(true);
  });

  it("returns history newest first", () => {
    markVideoSeen(makeVideo({ videoId: "first" }));
    markVideoSeen(makeVideo({ videoId: "second" }));
    markVideoSeen(makeVideo({ videoId: "third" }));

    expect(getHistory().map((v) => v.videoId)).toEqual(["third", "second", "first"]);
  });

  it("does not record the same video twice", () => {
    markVideoSeen(makeVideo({ videoId: "a" }));
    markVideoSeen(makeVideo({ videoId: "a" }));

    expect(getSeenVideoIds()).toEqual(["a"]);
  });

  it("removes a video from history", () => {
    markVideoSeen(makeVideo({ videoId: "a" }));
    markVideoSeen(makeVideo({ videoId: "b" }));

    removeVideoSeen("a");

    expect(getSeenVideoIds()).toEqual(["b"]);
  });

  it("keeps only the most recent MAX_ENTRIES (500) videos", () => {
    for (let i = 0; i < 501; i += 1) markVideoSeen(makeVideo({ videoId: `v${i}` }));

    const ids = getSeenVideoIds();
    expect(ids).toHaveLength(500);
    expect(ids).not.toContain("v0"); // oldest dropped
    expect(ids).toContain("v500"); // newest kept
  });

  it("round-trips a history large enough to span multiple chunk properties", () => {
    // Each entry serializes to a few hundred chars; 100 entries comfortably
    // exceeds the 3000-char CHUNK_SIZE, forcing a multi-property split.
    for (let i = 0; i < 100; i += 1) {
      markVideoSeen(makeVideo({ videoId: `v${i}`, title: `Title number ${i} with some length` }));
    }

    expect(getHistory()).toHaveLength(100);
    expect(getHistory()[0].videoId).toBe("v99");
  });
});
