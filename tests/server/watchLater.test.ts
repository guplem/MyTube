// The Watch Later server paths: the only code that writes to the user's real
// YouTube account. Pins today's behaviour so plan 003 (which adds locking) has a
// safety net. Covers playlist-id creation/reuse, the [] short-circuit and 10-min
// cache of the id set, and the add/remove paths that keep that cache in sync.
// See youtube.ts getWatchLaterPlaylistId/getWatchLaterVideoIds/add/remove.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installAppsScriptMocks,
  uninstallAppsScriptMocks,
  type AppsScriptMocks,
} from "../helpers/appsScriptMock";
import {
  getWatchLaterPlaylistId,
  getWatchLaterVideoIds,
  addToWatchLater,
  removeFromWatchLater,
} from "../../src/server/youtube";
import { getWatchLaterVideos } from "../../src/server/main";
import { playlistItemsPage } from "../helpers/fixtures";

let mocks: AppsScriptMocks;

beforeEach(() => {
  mocks = installAppsScriptMocks();
});
afterEach(() => {
  uninstallAppsScriptMocks();
});

describe("getWatchLaterPlaylistId", () => {
  it("returns the stored id without creating a playlist", () => {
    mocks.userProperties.setProperty("watchLaterPlaylistId", "WL-existing");
    let inserts = 0;
    mocks.youtube.Playlists = {
      list: () => ({ items: [] }),
      insert: () => {
        inserts += 1;
        return {};
      },
    };

    expect(getWatchLaterPlaylistId()).toBe("WL-existing");
    expect(inserts).toBe(0);
  });

  it("creates a private playlist titled 'MyTube — Watch Later' and stores its id", () => {
    let insertedResource: {
      snippet?: { title?: string };
      status?: { privacyStatus?: string };
    } = {};
    mocks.youtube.Playlists = {
      list: () => ({ items: [] }),
      insert: (resource: typeof insertedResource) => {
        insertedResource = resource;
        return { id: "WL-created" };
      },
    };

    const id = getWatchLaterPlaylistId();

    expect(id).toBe("WL-created");
    expect(insertedResource.snippet?.title).toBe("MyTube — Watch Later");
    expect(insertedResource.status?.privacyStatus).toBe("private");
    expect(mocks.userProperties.getProperty("watchLaterPlaylistId")).toBe(
      "WL-created",
    );
  });

  it("creates the playlist under the user lock", () => {
    mocks.youtube.Playlists = {
      list: () => ({ items: [] }),
      insert: () => ({ id: "WL-created" }),
    };

    getWatchLaterPlaylistId();

    expect(mocks.lockCalls).toEqual(["acquire", "release"]);
  });

  it("re-checks the stored id inside the lock and skips creating a duplicate", () => {
    let inserts = 0;
    mocks.youtube.Playlists = {
      list: () => ({ items: [] }),
      insert: () => {
        inserts += 1;
        return { id: "WL-loser" };
      },
    };
    // Simulate a concurrent execution that created the playlist while we waited
    // for the lock: the id appears in storage between the first check and ours.
    mocks.onLockWait = () => {
      mocks.userProperties.setProperty("watchLaterPlaylistId", "WL-winner");
    };

    expect(getWatchLaterPlaylistId()).toBe("WL-winner");
    expect(inserts).toBe(0);
  });
});

describe("getWatchLaterVideoIds", () => {
  it("returns [] and makes no API call when no playlist id is stored", () => {
    // A stray PlaylistItems.list call would throw, proving we never reach it.
    mocks.youtube.PlaylistItems = {
      list: () => {
        throw new Error("should not be called");
      },
      insert: () => ({}),
      remove: () => ({}),
    };

    expect(getWatchLaterVideoIds()).toEqual([]);
  });

  it("fetches once, then serves the second call from the user cache", () => {
    mocks.userProperties.setProperty("watchLaterPlaylistId", "WL");
    let listCalls = 0;
    mocks.youtube.PlaylistItems = {
      list: () => {
        listCalls += 1;
        return playlistItemsPage(["a", "b"]);
      },
      insert: () => ({}),
      remove: () => ({}),
    };

    expect(getWatchLaterVideoIds()).toEqual(["a", "b"]);
    expect(getWatchLaterVideoIds()).toEqual(["a", "b"]);
    expect(listCalls).toBe(1);
  });

  it("refetches when the cached id set is corrupt JSON", () => {
    mocks.userProperties.setProperty("watchLaterPlaylistId", "WL");
    mocks.userCache.put("watchLaterVideoIds", "{not json");
    let listCalls = 0;
    mocks.youtube.PlaylistItems = {
      list: () => {
        listCalls += 1;
        return playlistItemsPage(["a", "b"]);
      },
      insert: () => ({}),
      remove: () => ({}),
    };

    expect(getWatchLaterVideoIds()).toEqual(["a", "b"]);
    expect(listCalls).toBe(1);
  });
});

describe("addToWatchLater", () => {
  it("inserts the video and updates the cached id set without a refetch", () => {
    mocks.userProperties.setProperty("watchLaterPlaylistId", "WL");
    // Seed the cache so the in-place update path runs (no cache = next read fetches fresh).
    mocks.userCache.put("watchLaterVideoIds", JSON.stringify(["a"]));
    let inserted: {
      snippet?: { playlistId?: string; resourceId?: { videoId?: string } };
    } = {};
    let listCalls = 0;
    mocks.youtube.PlaylistItems = {
      list: () => {
        listCalls += 1;
        return playlistItemsPage([]);
      },
      insert: (resource: typeof inserted) => {
        inserted = resource;
        return {};
      },
      remove: () => ({}),
    };

    addToWatchLater("b");

    expect(inserted.snippet?.playlistId).toBe("WL");
    expect(inserted.snippet?.resourceId?.videoId).toBe("b");
    expect(getWatchLaterVideoIds()).toEqual(["a", "b"]);
    expect(listCalls).toBe(0); // served from the updated cache
  });
});

describe("getWatchLaterVideos", () => {
  it("flags every returned video as in Watch Later, so the card toggle starts on", () => {
    mocks.userProperties.setProperty("watchLaterPlaylistId", "WL");
    mocks.youtube.PlaylistItems = {
      list: () => playlistItemsPage(["a", "b"]),
      insert: () => ({}),
      remove: () => ({}),
    };

    const videos = getWatchLaterVideos();

    expect(videos.map((video) => video.videoId)).toEqual(["a", "b"]);
    expect(videos.map((video) => video.inWatchLater)).toEqual([true, true]);
  });

  it("logs one stage timing line and reads the user properties once", () => {
    mocks.userProperties.setProperty("watchLaterPlaylistId", "WL");
    mocks.youtube.PlaylistItems = {
      list: () => playlistItemsPage(["a"]),
      insert: () => ({}),
      remove: () => ({}),
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const before = mocks.userProperties.getPropertiesCalls;

    getWatchLaterVideos();

    expect(mocks.userProperties.getPropertiesCalls - before).toBe(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toMatch(
      /^getWatchLaterVideos \d+ms \| playlist \d+ms \(1 videos\) \| history \d+ms \| durations \d+ms \| titles \d+ms$/,
    );
    log.mockRestore();
  });
});

describe("removeFromWatchLater", () => {
  it("removes the first matching item, paging until it is found", () => {
    mocks.userProperties.setProperty("watchLaterPlaylistId", "WL");
    const removed: string[] = [];
    let listCalls = 0;
    // Two pages via nextPageToken; the match ("target") is on page 2.
    mocks.youtube.PlaylistItems = {
      list: (_part: unknown, params: { pageToken?: string }) => {
        listCalls += 1;
        if (!params.pageToken) {
          return { ...playlistItemsPage(["a", "b"]), nextPageToken: "PAGE2" };
        }
        return playlistItemsPage(["target", "c"]);
      },
      insert: () => ({}),
      remove: (id: string) => {
        removed.push(id);
        return {};
      },
    };

    removeFromWatchLater("target");

    expect(removed).toEqual(["item-target"]);
    expect(listCalls).toBe(2);
  });

  it("is a no-op when the video is not in the playlist", () => {
    mocks.userProperties.setProperty("watchLaterPlaylistId", "WL");
    const removed: string[] = [];
    mocks.youtube.PlaylistItems = {
      list: () => playlistItemsPage(["a", "b"]),
      insert: () => ({}),
      remove: (id: string) => {
        removed.push(id);
        return {};
      },
    };

    removeFromWatchLater("z");

    expect(removed).toEqual([]);
  });
});
