// Core concept: every list that main.ts returns carries the DeArrow community
// title, the feed asks only for the page on show, and a DeArrow failure leaves
// every list intact with its YouTube titles.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installAppsScriptMocks,
  uninstallAppsScriptMocks,
  httpResponse,
  type AppsScriptMocks,
} from "../helpers/appsScriptMock";
import {
  channelRss,
  makeVideo,
  playlistItemsPage,
  type RssEntry,
} from "../helpers/fixtures";
import {
  getFeedPage,
  getHistory,
  getPlaylistVideos,
  getWatchLaterVideos,
} from "../../src/server/main";
import { markVideoSeen } from "../../src/server/history";
import type { FeedPageOptions } from "../../src/shared/feed";

let mocks: AppsScriptMocks;

beforeEach(() => {
  mocks = installAppsScriptMocks();
});
afterEach(() => {
  uninstallAppsScriptMocks();
});

// "dQw4w9WgXcQ" hashes to 5f6b..., "abcdefghijk" to ca2f....
const WITH_TITLE = "dQw4w9WgXcQ";
const WITHOUT_TITLE = "abcdefghijk";
const DEARROW_BASE = "https://sponsor.ajay.app/api/branding/";

const OPTIONS: FeedPageOptions = {
  page: 0,
  pageSize: 10,
  forceRefresh: false,
  hideShorts: false,
  hideViewed: false,
  hideDismissed: false,
  hideSaved: false,
  beforeDate: "",
};

function rssEntry(videoId: string, publishedAt: string): RssEntry {
  return {
    videoId,
    title: "YouTube " + videoId,
    channelId: "C1",
    channelTitle: "One",
    publishedAt,
  };
}

/** Serves the channel RSS, and answers DeArrow with `dearrow` per URL. The
 *  feed lists WITH_TITLE first, because it is the newer upload. Returns the
 *  DeArrow URLs asked. */
function seed(
  dearrow: (url: string) => ReturnType<typeof httpResponse>,
): string[] {
  const asked: string[] = [];
  mocks.userProperties.setProperty(
    "subscriptionChannels",
    JSON.stringify({
      fetchedAt: Date.now(),
      channels: [{ channelId: "C1", title: "One" }],
    }),
  );
  const rss = channelRss([
    rssEntry(WITH_TITLE, "2026-06-21T10:00:00+00:00"),
    rssEntry(WITHOUT_TITLE, "2026-06-20T10:00:00+00:00"),
  ]);
  mocks.fetchAll = (requests) =>
    requests.map((request) => {
      if (!request.url.startsWith(DEARROW_BASE)) return httpResponse(200, rss);
      asked.push(request.url);
      return dearrow(request.url);
    });
  return asked;
}

/** Serves `videoIds` as the items of every playlist. */
function seedPlaylist(videoIds: string[]): void {
  mocks.userProperties.setProperty("watchLaterPlaylistId", "WL");
  mocks.youtube.PlaylistItems = {
    list: () => playlistItemsPage(videoIds),
    insert: () => ({}),
    remove: () => ({}),
  };
}

/** Makes every script cache read of a DeArrow key throw. */
function breakDeArrowCache(): void {
  const cache = mocks.scriptCache;
  const original = cache.getAll.bind(cache);
  cache.getAll = (keys: string[]) => {
    if (keys.some((key) => key.startsWith("da:")))
      throw new Error("cache down");
    return original(keys);
  };
}

function dearrowAnswer(url: string): ReturnType<typeof httpResponse> {
  if (url !== DEARROW_BASE + "5f6b") return httpResponse(404, "");
  return httpResponse(
    200,
    JSON.stringify({
      [WITH_TITLE]: {
        titles: [
          { title: "Calm title", original: false, votes: 3, locked: false },
        ],
      },
    }),
  );
}

describe("community titles on lists", () => {
  it("sets communityTitle on the feed page's videos", () => {
    seed(dearrowAnswer);

    const page = getFeedPage(OPTIONS);

    const byId = new Map(page.videos.map((video) => [video.videoId, video]));
    expect(byId.get(WITH_TITLE)?.communityTitle).toBe("Calm title");
    expect(byId.get(WITH_TITLE)?.title).toBe("YouTube " + WITH_TITLE);
    expect(byId.get(WITHOUT_TITLE)?.communityTitle).toBeUndefined();
  });

  it("sets communityTitle on the history's videos", () => {
    seed(dearrowAnswer);
    markVideoSeen(makeVideo({ videoId: WITH_TITLE, title: "Clickbait" }));

    const videos = getHistory();

    expect(videos[0].communityTitle).toBe("Calm title");
    expect(videos[0].title).toBe("Clickbait");
  });

  it("keeps the feed page intact when DeArrow fails", () => {
    seed(() => httpResponse(500, ""));

    const page = getFeedPage(OPTIONS);

    expect(page.videos.map((video) => video.title).sort()).toEqual([
      "YouTube " + WITHOUT_TITLE,
      "YouTube " + WITH_TITLE,
    ]);
    expect(page.videos.every((video) => !video.communityTitle)).toBe(true);
  });

  it("sets no inherited value on a video whose id is constructor", () => {
    seed(dearrowAnswer);
    markVideoSeen(makeVideo({ videoId: "constructor", title: "Plain" }));

    const [video] = getHistory();

    expect(video.communityTitle).toBeUndefined();
    expect(video.title).toBe("Plain");
  });

  it("asks DeArrow only for the videos on the page", () => {
    const asked = seed(dearrowAnswer);

    const page = getFeedPage({ ...OPTIONS, pageSize: 1 });

    expect(page.videos.map((video) => video.videoId)).toEqual([WITH_TITLE]);
    expect(page.total).toBe(2);
    expect(asked).toEqual([DEARROW_BASE + "5f6b"]);
  });

  it("sets communityTitle on a playlist's videos", () => {
    seed(dearrowAnswer);
    seedPlaylist([WITH_TITLE, WITHOUT_TITLE]);

    const videos = getPlaylistVideos("PL");

    expect(videos.map((video) => video.communityTitle)).toEqual([
      "Calm title",
      undefined,
    ]);
  });

  it("sets communityTitle on the Watch Later videos", () => {
    seed(dearrowAnswer);
    seedPlaylist([WITHOUT_TITLE, WITH_TITLE]);

    const videos = getWatchLaterVideos();

    expect(videos.map((video) => video.communityTitle)).toEqual([
      undefined,
      "Calm title",
    ]);
  });

  it("returns the lists with YouTube titles when the lookup throws", () => {
    seed(dearrowAnswer);
    seedPlaylist([WITH_TITLE]);
    breakDeArrowCache();

    const page = getFeedPage(OPTIONS);
    const playlist = getPlaylistVideos("PL");

    expect(page.videos.map((video) => video.videoId)).toEqual([
      WITH_TITLE,
      WITHOUT_TITLE,
    ]);
    expect(page.videos.every((video) => !video.communityTitle)).toBe(true);
    expect(playlist.map((video) => video.title)).toEqual([WITH_TITLE]);
    expect(playlist[0].communityTitle).toBeUndefined();
  });
});
