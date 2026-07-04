// Marking a video seen also drops it from Watch Later, from EVERY screen and the
// player (not just the Watch Later list). The coupling lives in the server
// markVideoSeen so all callers get it for free. It is guarded on Watch Later
// membership so it costs nothing when the video isn't saved or there is no
// Watch Later playlist yet.
//
// undoMarkVideoSeen is the inverse, used by the Watch Later screen's seen
// toggle: it un-marks the view AND restores the video to Watch Later, so a
// mis-tapped "Mark seen" is fully undone with a second tap.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installAppsScriptMocks,
  uninstallAppsScriptMocks,
  type AppsScriptMocks,
} from "../helpers/appsScriptMock";
import { makeVideo } from "../helpers/fixtures";
import { markVideoSeen, undoMarkVideoSeen } from "../../src/server/main";
import { getSeenVideoIds, markVideoSeen as recordSeen } from "../../src/server/history";

let mocks: AppsScriptMocks;
let removed: string[];
let inserted: string[];
let listCalls: number;

beforeEach(() => {
  mocks = installAppsScriptMocks();
  removed = [];
  inserted = [];
  listCalls = 0;
});
afterEach(() => {
  uninstallAppsScriptMocks();
});

// Seed an existing Watch Later playlist whose items are the given video ids.
// Wires PlaylistItems.list (paged, used by both the membership read and the
// removal scan), PlaylistItems.remove (records the removed item id), and
// PlaylistItems.insert (records the inserted video id).
function seedWatchLater(videoIds: string[]): void {
  mocks.userProperties.setProperty("watchLaterPlaylistId", "WL");
  const items = videoIds.map((videoId) => ({
    id: `item-${videoId}`,
    snippet: { title: videoId, resourceId: { videoId }, thumbnails: {} },
    contentDetails: { videoId },
  }));
  mocks.youtube.PlaylistItems = {
    list: () => {
      listCalls += 1;
      return { items: items.filter((item) => !removed.includes(item.id)) };
    },
    insert: (resource: { snippet: { resourceId: { videoId: string } } }) => {
      const videoId = resource.snippet.resourceId.videoId;
      inserted.push(videoId);
      items.push({
        id: `item-${videoId}`,
        snippet: { title: videoId, resourceId: { videoId }, thumbnails: {} },
        contentDetails: { videoId },
      });
      return {};
    },
    remove: (id: string) => {
      removed.push(id);
      return {};
    },
  };
}

describe("markVideoSeen + Watch Later", () => {
  it("removes the video from Watch Later when it is saved there", () => {
    seedWatchLater(["a", "b"]);

    markVideoSeen(makeVideo({ videoId: "a" }));

    expect(removed).toEqual(["item-a"]);
    expect(getSeenVideoIds()).toContain("a");
  });

  it("leaves Watch Later untouched when the video is not in it", () => {
    seedWatchLater(["a", "b"]);

    markVideoSeen(makeVideo({ videoId: "z" }));

    expect(removed).toEqual([]);
    expect(getSeenVideoIds()).toContain("z");
  });

  it("records the view without any Watch Later API call when there is no Watch Later playlist", () => {
    // No watchLaterPlaylistId property and no PlaylistItems stub: a stray call
    // would throw, so this also asserts we never reach the API.
    markVideoSeen(makeVideo({ videoId: "a" }));

    expect(listCalls).toBe(0);
    expect(getSeenVideoIds()).toContain("a");
  });

  it("still records the view when the Watch Later removal throws", () => {
    seedWatchLater(["a", "b"]);
    mocks.youtube.PlaylistItems!.remove = () => {
      throw new Error("removal failed");
    };

    expect(() => markVideoSeen(makeVideo({ videoId: "a" }))).not.toThrow();
    expect(getSeenVideoIds()).toContain("a");
  });
});

describe("undoMarkVideoSeen", () => {
  it("un-marks the view and restores the video to Watch Later", () => {
    seedWatchLater(["b"]);
    recordSeen(makeVideo({ videoId: "a" })); // "a" was marked seen and dropped from Watch Later

    undoMarkVideoSeen("a");

    expect(inserted).toEqual(["a"]);
    expect(getSeenVideoIds()).not.toContain("a");
  });

  it("round-trips with markVideoSeen: mark then undo leaves Watch Later as it was", () => {
    seedWatchLater(["a", "b"]);

    markVideoSeen(makeVideo({ videoId: "a" }));
    undoMarkVideoSeen("a");

    expect(removed).toEqual(["item-a"]);
    expect(inserted).toEqual(["a"]);
    expect(getSeenVideoIds()).not.toContain("a");
  });

  it("does not add a duplicate when the video is still in Watch Later", () => {
    seedWatchLater(["a", "b"]);
    recordSeen(makeVideo({ videoId: "a" }));

    undoMarkVideoSeen("a");

    expect(inserted).toEqual([]);
    expect(getSeenVideoIds()).not.toContain("a");
  });

  it("un-marks without any Watch Later API call when there is no Watch Later playlist", () => {
    // No watchLaterPlaylistId property and no PlaylistItems stub: a stray call
    // (including a playlist creation) would throw, so this also asserts we
    // never reach the API.
    recordSeen(makeVideo({ videoId: "a" }));

    undoMarkVideoSeen("a");

    expect(listCalls).toBe(0);
    expect(getSeenVideoIds()).not.toContain("a");
  });

  it("keeps the video marked seen when the restore fails, so the UI can roll back", () => {
    seedWatchLater(["b"]);
    recordSeen(makeVideo({ videoId: "a" }));
    mocks.youtube.PlaylistItems!.insert = () => {
      throw new Error("insert failed");
    };

    expect(() => undoMarkVideoSeen("a")).toThrow();
    expect(getSeenVideoIds()).toContain("a");
  });
});
