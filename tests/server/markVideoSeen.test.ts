// Marking a video seen also drops it from Watch Later, from EVERY screen and the
// player (not just the Watch Later list). The coupling lives in the server
// markVideoSeen so all callers get it for free. It is guarded on Watch Later
// membership so it costs nothing when the video isn't saved or there is no
// Watch Later playlist yet.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installAppsScriptMocks,
  uninstallAppsScriptMocks,
  type AppsScriptMocks,
} from "../helpers/appsScriptMock";
import { makeVideo } from "../helpers/fixtures";
import { markVideoSeen } from "../../src/server/main";
import { getSeenVideoIds } from "../../src/server/history";

let mocks: AppsScriptMocks;
let removed: string[];
let listCalls: number;

beforeEach(() => {
  mocks = installAppsScriptMocks();
  removed = [];
  listCalls = 0;
});
afterEach(() => {
  uninstallAppsScriptMocks();
});

// Seed an existing Watch Later playlist whose items are the given video ids.
// Wires PlaylistItems.list (paged, used by both the membership read and the
// removal scan) and PlaylistItems.remove (records the removed item id).
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
    insert: () => ({}),
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
