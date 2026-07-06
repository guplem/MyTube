// Per-user video playback progress in PropertiesService: save, upsert, clear
// on zero, the recency cap, and the chunked storage that mirrors the watch
// history. See progress.ts.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installAppsScriptMocks,
  uninstallAppsScriptMocks,
  type AppsScriptMocks,
} from "../helpers/appsScriptMock";
import { saveVideoProgress, getProgressSeconds } from "../../src/server/progress";
import { PROGRESS_FINISHED } from "../../src/shared/videoProgress";
import { getHistory, markVideoSeen } from "../../src/server/main";
import { makeVideo } from "../helpers/fixtures";

let mocks: AppsScriptMocks;

beforeEach(() => {
  mocks = installAppsScriptMocks();
});
afterEach(() => {
  uninstallAppsScriptMocks();
});

describe("video progress store", () => {
  it("saves and returns a video's position", () => {
    saveVideoProgress("a", 120);
    expect(getProgressSeconds()).toEqual({ a: 120 });
  });

  it("updates the position on a later save", () => {
    saveVideoProgress("a", 120);
    saveVideoProgress("a", 300);
    expect(getProgressSeconds()).toEqual({ a: 300 });
  });

  it("keeps positions for several videos", () => {
    saveVideoProgress("a", 10);
    saveVideoProgress("b", 20);
    expect(getProgressSeconds()).toEqual({ a: 10, b: 20 });
  });

  it("rounds fractional seconds down to whole seconds", () => {
    saveVideoProgress("a", 61.87);
    expect(getProgressSeconds()).toEqual({ a: 61 });
  });

  it("clears the stored position when saving zero", () => {
    saveVideoProgress("a", 120);
    saveVideoProgress("a", 0);
    expect(getProgressSeconds()).toEqual({});
  });

  it("treats a negative position as a clear", () => {
    saveVideoProgress("a", 120);
    saveVideoProgress("a", -5);
    expect(getProgressSeconds()).toEqual({});
  });

  it("is a no-op to clear a video that has no stored position", () => {
    saveVideoProgress("a", 120);
    saveVideoProgress("missing", 0);
    expect(getProgressSeconds()).toEqual({ a: 120 });
  });

  it("stores the finished marker", () => {
    saveVideoProgress("a", PROGRESS_FINISHED);
    expect(getProgressSeconds()).toEqual({ a: PROGRESS_FINISHED });
  });

  it("overwrites a mid-video position with the finished marker", () => {
    saveVideoProgress("a", 120);
    saveVideoProgress("a", PROGRESS_FINISHED);
    expect(getProgressSeconds()).toEqual({ a: PROGRESS_FINISHED });
  });

  it("overwrites the finished marker with a rewatch position", () => {
    saveVideoProgress("a", PROGRESS_FINISHED);
    saveVideoProgress("a", 120);
    expect(getProgressSeconds()).toEqual({ a: 120 });
  });

  it("clears a finished entry when saving zero", () => {
    saveVideoProgress("a", PROGRESS_FINISHED);
    saveVideoProgress("a", 0);
    expect(getProgressSeconds()).toEqual({});
  });

  it("skips the write when the video is already marked finished", () => {
    saveVideoProgress("a", PROGRESS_FINISHED);
    let writes = 0;
    const realSetProperties = mocks.userProperties.setProperties.bind(mocks.userProperties);
    mocks.userProperties.setProperties = (properties, deleteAllOthers) => {
      writes += 1;
      return realSetProperties(properties, deleteAllOthers);
    };

    saveVideoProgress("a", PROGRESS_FINISHED);

    expect(writes).toBe(0);
    expect(getProgressSeconds()).toEqual({ a: PROGRESS_FINISHED });
  });

  it("skips the write when the position has not changed", () => {
    saveVideoProgress("a", 120);
    let writes = 0;
    const realSetProperties = mocks.userProperties.setProperties.bind(mocks.userProperties);
    mocks.userProperties.setProperties = (properties, deleteAllOthers) => {
      writes += 1;
      return realSetProperties(properties, deleteAllOthers);
    };

    saveVideoProgress("a", 120);

    expect(writes).toBe(0);
    expect(getProgressSeconds()).toEqual({ a: 120 });
  });

  it("drops the oldest entries beyond the cap, keeping the most recently saved", () => {
    for (let i = 0; i < 505; i += 1) saveVideoProgress(`video-${i}`, i + 30);
    const progress = getProgressSeconds();
    expect(Object.keys(progress)).toHaveLength(500);
    expect(progress["video-0"]).toBeUndefined();
    expect(progress["video-4"]).toBeUndefined();
    expect(progress["video-5"]).toBe(35);
    expect(progress["video-504"]).toBe(534);
  });

  it("re-saving an old video makes it recent again for the cap", () => {
    saveVideoProgress("first", 100);
    for (let i = 0; i < 499; i += 1) saveVideoProgress(`filler-${i}`, 30);
    // "first" is now the oldest entry; updating it must move it to the front
    // of the recency order so the next new video evicts a filler instead.
    saveVideoProgress("first", 200);
    saveVideoProgress("newcomer", 40);
    const progress = getProgressSeconds();
    expect(progress["first"]).toBe(200);
    expect(progress["newcomer"]).toBe(40);
    expect(progress["filler-0"]).toBeUndefined();
  });

  it("acquires and releases the user lock around a mutation", () => {
    saveVideoProgress("a", 120);

    expect(mocks.lockCalls).toEqual(["acquire", "release"]);
  });

  it("releases the lock even when the write throws", () => {
    mocks.userProperties.setProperties = () => {
      throw new Error("write failed");
    };

    expect(() => saveVideoProgress("a", 120)).toThrow("write failed");
    expect(mocks.lockCalls[mocks.lockCalls.length - 1]).toBe("release");
  });

  it("does not delete unrelated properties when writing", () => {
    mocks.userProperties.setProperty("subscriptionChannels", "keep-me");
    let deletedAllOthers = false;
    const realSetProperties = mocks.userProperties.setProperties.bind(mocks.userProperties);
    mocks.userProperties.setProperties = (properties, deleteAllOthers) => {
      if (deleteAllOthers) deletedAllOthers = true;
      return realSetProperties(properties, deleteAllOthers);
    };

    saveVideoProgress("a", 120);

    expect(mocks.userProperties.getProperty("subscriptionChannels")).toBe("keep-me");
    expect(deletedAllOthers).toBe(false);
  });

  it("round-trips a store large enough to span multiple chunk properties", () => {
    for (let i = 0; i < 500; i += 1) saveVideoProgress(`video-id-${i}`, i + 30);
    const progress = getProgressSeconds();
    expect(Object.keys(progress)).toHaveLength(500);
    expect(progress["video-id-0"]).toBe(30);
    expect(progress["video-id-499"]).toBe(529);
  });
});

describe("progress flagging on video lists", () => {
  it("flags each history video with its stored resume position", () => {
    markVideoSeen(makeVideo({ videoId: "watched" }));
    markVideoSeen(makeVideo({ videoId: "finished" }));
    saveVideoProgress("watched", 250);

    const videos = getHistory();

    const watched = videos.find((video) => video.videoId === "watched");
    const finished = videos.find((video) => video.videoId === "finished");
    expect(watched?.progressSeconds).toBe(250);
    expect(finished?.progressSeconds).toBeUndefined();
  });
});
