// Core concept: server-side paging and filtering of the subscriptions feed.
// getFeedPage builds the full feed, flags seen/dismissed, applies the
// hideViewed / hideDismissed / hideSaved / beforeDate / hideShorts filters, then
// returns a single page plus the total. Shorts are detected by duration
// (<= 180s), not a flag. See CLAUDE.md and PLAN.md section 5.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installAppsScriptMocks,
  uninstallAppsScriptMocks,
  httpResponse,
  type AppsScriptMocks,
} from "../helpers/appsScriptMock";
import {
  channelRss,
  playlistItemsPage,
  type RssEntry,
} from "../helpers/fixtures";
import { getFeedPage } from "../../src/server/main";
import { markVideoSeen } from "../../src/server/history";
import { markVideoDismissed } from "../../src/server/dismissed";
import type { FeedPageOptions } from "../../src/shared/feed";

let mocks: AppsScriptMocks;

beforeEach(() => {
  mocks = installAppsScriptMocks();
});
afterEach(() => {
  uninstallAppsScriptMocks();
});

/** Seed one subscription whose RSS returns exactly these entries. */
function seedFeed(entries: RssEntry[]): void {
  mocks.userProperties.setProperty(
    "subscriptionChannels",
    JSON.stringify({
      fetchedAt: Date.now(),
      channels: [{ channelId: "C1", title: "One" }],
    }),
  );
  mocks.fetchAll = () => [httpResponse(200, channelRss(entries))];
}

/**
 * Stub the Data API duration lookup: videoId -> ISO 8601 duration. The returned
 * array records the ids actually sent to the Data API, so a test can assert
 * which videos reached the paid call. An id already in the duration cache never
 * appears: getVideoLengths serves it from the cache without asking.
 */
function seedDurations(durations: { [videoId: string]: string }): string[] {
  const askedFor: string[] = [];
  mocks.youtube.Videos = {
    list: (_part: unknown, params: { id: string }) => {
      askedFor.push(...params.id.split(","));
      return {
        items: params.id
          .split(",")
          .filter((id) => id in durations)
          .map((id) => ({ id, contentDetails: { duration: durations[id] } })),
      };
    },
  };
  return askedFor;
}

/** Seed a Watch Later playlist holding exactly these video ids. */
function seedWatchLater(videoIds: string[]): void {
  mocks.userProperties.setProperty("watchLaterPlaylistId", "WL");
  mocks.youtube.PlaylistItems = {
    list: () => playlistItemsPage(videoIds),
    insert: () => ({}),
    remove: () => ({}),
  };
}

function entry(videoId: string, publishedAt: string): RssEntry {
  return {
    videoId,
    title: videoId,
    channelId: "C1",
    channelTitle: "One",
    publishedAt,
  };
}

const baseOptions: FeedPageOptions = {
  page: 0,
  pageSize: 10,
  forceRefresh: false,
  hideShorts: false,
  hideUpcoming: false,
  hideViewed: false,
  hideDismissed: false,
  hideSaved: false,
  beforeDate: "",
};

describe("getFeedPage", () => {
  it("returns one page and the full total", () => {
    seedFeed(
      Array.from({ length: 25 }, (_, i) =>
        entry(
          `v${String(i).padStart(2, "0")}`,
          `2026-06-${String(25 - i).padStart(2, "0")}T00:00:00+00:00`,
        ),
      ),
    );

    const page = getFeedPage({ ...baseOptions, page: 1, pageSize: 10 });

    expect(page.total).toBe(25);
    expect(page.videos).toHaveLength(10);
    // Newest first, so page 1 (0-based) is videos 10..19.
    expect(page.videos[0].videoId).toBe("v10");
    expect(page.videos[9].videoId).toBe("v19");
  });

  it("hides viewed videos when hideViewed is on", () => {
    seedFeed([
      entry("a", "2026-06-20T00:00:00+00:00"),
      entry("b", "2026-06-19T00:00:00+00:00"),
    ]);
    markVideoSeen({
      videoId: "a",
      title: "a",
      channelId: "C1",
      channelTitle: "One",
      thumbnailUrl: "",
      publishedAt: "2026-06-20T00:00:00+00:00",
      seen: true,
    });

    const page = getFeedPage({ ...baseOptions, hideViewed: true });

    expect(page.videos.map((v) => v.videoId)).toEqual(["b"]);
    expect(page.total).toBe(1);
  });

  it("flags seen videos but keeps them when hideViewed is off", () => {
    seedFeed([entry("a", "2026-06-20T00:00:00+00:00")]);
    markVideoSeen({
      videoId: "a",
      title: "a",
      channelId: "C1",
      channelTitle: "One",
      thumbnailUrl: "",
      publishedAt: "2026-06-20T00:00:00+00:00",
      seen: true,
    });

    const page = getFeedPage({ ...baseOptions, hideViewed: false });

    expect(page.videos).toHaveLength(1);
    expect(page.videos[0].seen).toBe(true);
  });

  it("hides dismissed videos when hideDismissed is on", () => {
    seedFeed([
      entry("a", "2026-06-20T00:00:00+00:00"),
      entry("b", "2026-06-19T00:00:00+00:00"),
    ]);
    markVideoDismissed("b");

    const page = getFeedPage({ ...baseOptions, hideDismissed: true });

    expect(page.videos.map((v) => v.videoId)).toEqual(["a"]);
  });

  it("hides videos already in Watch Later when hideSaved is on", () => {
    seedFeed([
      entry("a", "2026-06-20T00:00:00+00:00"),
      entry("b", "2026-06-19T00:00:00+00:00"),
    ]);
    seedWatchLater(["b"]);

    const page = getFeedPage({ ...baseOptions, hideSaved: true });

    expect(page.videos.map((v) => v.videoId)).toEqual(["a"]);
    // The nav badge counts total, so the filter must shrink it too.
    expect(page.total).toBe(1);
  });

  it("keeps saved videos and still flags them when hideSaved is off", () => {
    seedFeed([
      entry("a", "2026-06-20T00:00:00+00:00"),
      entry("b", "2026-06-19T00:00:00+00:00"),
    ]);
    seedWatchLater(["b"]);

    const page = getFeedPage({ ...baseOptions, hideSaved: false });

    expect(page.videos.map((v) => v.videoId)).toEqual(["a", "b"]);
    expect(page.videos.map((v) => v.inWatchLater)).toEqual([false, true]);
  });

  it("drops saved videos before paging, so the page has no hole", () => {
    seedFeed([
      entry("a", "2026-06-20T00:00:00+00:00"),
      entry("b", "2026-06-19T00:00:00+00:00"),
      entry("c", "2026-06-18T00:00:00+00:00"),
    ]);
    seedWatchLater(["b"]);

    const page = getFeedPage({ ...baseOptions, hideSaved: true, pageSize: 2 });

    // Filtering after the slice would return only ["a"]; the page must be
    // filled from the videos that survive the filter.
    expect(page.videos.map((v) => v.videoId)).toEqual(["a", "c"]);
    expect(page.total).toBe(2);
  });

  it("hides nothing and makes no API call when there is no Watch Later playlist", () => {
    seedFeed([
      entry("a", "2026-06-20T00:00:00+00:00"),
      entry("b", "2026-06-19T00:00:00+00:00"),
    ]);
    // Count the calls instead of throwing inside the mock: flagInWatchLater
    // swallows every error, so a thrower would keep this test green even if
    // the call did happen.
    let listCalls = 0;
    mocks.youtube.PlaylistItems = {
      list: () => {
        listCalls += 1;
        return playlistItemsPage([]);
      },
      insert: () => ({}),
      remove: () => ({}),
    };

    const page = getFeedPage({ ...baseOptions, hideSaved: true });

    expect(page.videos.map((v) => v.videoId)).toEqual(["a", "b"]);
    expect(page.total).toBe(2);
    // No stored playlist id short-circuits getWatchLaterVideoIds to [], so the
    // filter never costs an API round-trip for a user who never saved anything.
    expect(listCalls).toBe(0);
  });

  it("drops saved videos before looking up any duration for hideShorts", () => {
    seedFeed([
      entry("saved", "2026-06-20T00:00:00+00:00"),
      entry("short", "2026-06-19T00:00:00+00:00"),
      entry("normal", "2026-06-18T00:00:00+00:00"),
    ]);
    seedWatchLater(["saved"]);
    const durationLookups = seedDurations({
      saved: "PT30S",
      short: "PT30S",
      normal: "PT10M",
    });

    const page = getFeedPage({
      ...baseOptions,
      hideSaved: true,
      hideShorts: true,
    });

    expect(page.videos.map((v) => v.videoId)).toEqual(["normal"]);
    expect(page.total).toBe(1);
    // The duration lookup is the only filter that costs an API call, so it must
    // stay last: a saved video is gone before anyone asks how long it is.
    expect(durationLookups).toEqual(["short", "normal"]);
  });

  it("hides videos published before beforeDate without touching seen", () => {
    seedFeed([
      entry("recent", "2026-06-20T00:00:00+00:00"),
      entry("old", "2026-01-01T00:00:00+00:00"),
    ]);

    const page = getFeedPage({ ...baseOptions, beforeDate: "2026-06-01" });

    expect(page.videos.map((v) => v.videoId)).toEqual(["recent"]);
  });

  it("hides Shorts (<= 180s) by duration when hideShorts is on", () => {
    seedFeed([
      entry("long", "2026-06-20T00:00:00+00:00"),
      entry("short", "2026-06-19T00:00:00+00:00"),
    ]);
    seedDurations({ long: "PT10M", short: "PT45S" });

    const page = getFeedPage({ ...baseOptions, hideShorts: true });

    expect(page.videos.map((v) => v.videoId)).toEqual(["long"]);
    expect(page.videos[0].durationSeconds).toBe(600);
  });

  describe("announced videos", () => {
    // Three hours ahead of the real clock: the cache keeps an upcoming video
    // until its start, so the start must be in the future when the test runs.
    const start: string = new Date(Date.now() + 3 * 3600 * 1000).toISOString();

    function seedLengths(): void {
      mocks.youtube.Videos = {
        list: (_part: unknown, params: { id: string }) => ({
          items: params.id.split(",").map((id) =>
            id === "premiere"
              ? {
                  id,
                  contentDetails: { duration: "P0D" },
                  liveStreamingDetails: { scheduledStartTime: start },
                }
              : { id, contentDetails: { duration: "PT10M" } },
          ),
        }),
      };
    }

    it("hides a video that is not out yet when hideUpcoming is on", () => {
      seedFeed([
        entry("premiere", "2026-06-20T00:00:00+00:00"),
        entry("out", "2026-06-19T00:00:00+00:00"),
      ]);
      seedLengths();

      const page = getFeedPage({ ...baseOptions, hideUpcoming: true });

      expect(page.videos.map((v) => v.videoId)).toEqual(["out"]);
      expect(page.total).toBe(1);
    });

    it("hides it on every page, not only the page it would sit on", () => {
      seedFeed([
        entry("out1", "2026-06-21T00:00:00+00:00"),
        entry("premiere", "2026-06-20T00:00:00+00:00"),
        entry("out2", "2026-06-19T00:00:00+00:00"),
      ]);
      seedLengths();

      const page = getFeedPage({
        ...baseOptions,
        hideUpcoming: true,
        page: 1,
        pageSize: 1,
      });

      expect(page.videos.map((v) => v.videoId)).toEqual(["out2"]);
      expect(page.total).toBe(2);
    });

    it("keeps it, marked with its scheduled start, when hideUpcoming is off", () => {
      seedFeed([
        entry("premiere", "2026-06-20T00:00:00+00:00"),
        entry("out", "2026-06-19T00:00:00+00:00"),
      ]);
      seedLengths();

      const page = getFeedPage({ ...baseOptions, hideUpcoming: false });

      expect(page.videos.map((v) => v.videoId)).toEqual(["premiere", "out"]);
      expect(page.videos[0].scheduledStartAt).toBe(start);
      expect(page.videos[1].scheduledStartAt).toBeUndefined();
    });
  });

  it("keeps Shorts and still fills the duration badge when hideShorts is off", () => {
    seedFeed([
      entry("long", "2026-06-20T00:00:00+00:00"),
      entry("short", "2026-06-19T00:00:00+00:00"),
    ]);
    seedDurations({ long: "PT10M", short: "PT45S" });

    const page = getFeedPage({ ...baseOptions, hideShorts: false });

    expect(page.videos.map((v) => v.videoId)).toEqual(["long", "short"]);
    expect(page.videos.map((v) => v.durationSeconds)).toEqual([600, 45]);
  });

  it("returns the full list when the duration lookup throws (nothing filtered as a Short)", () => {
    seedFeed([
      entry("a", "2026-06-20T00:00:00+00:00"),
      entry("b", "2026-06-19T00:00:00+00:00"),
    ]);
    mocks.youtube.Videos = {
      list: () => {
        throw new Error("duration lookup failed");
      },
    };

    const page = getFeedPage({ ...baseOptions, hideShorts: true });

    expect(page.videos.map((v) => v.videoId)).toEqual(["a", "b"]);
    expect(page.total).toBe(2);
  });
});

describe("getFeedPage, user property reads", () => {
  it("reads the whole user property store once per page, not once per flag", () => {
    seedFeed([entry("a", "2026-06-20T10:00:00+00:00")]);
    seedDurations({ a: "PT10M" });
    markVideoSeen({
      videoId: "a",
      title: "a",
      channelId: "C1",
      channelTitle: "One",
      thumbnailUrl: "",
      publishedAt: "2026-06-20T10:00:00+00:00",
      seen: false,
    });
    markVideoDismissed("b");
    const before = mocks.userProperties.getPropertiesCalls;

    const page = getFeedPage({
      page: 0,
      pageSize: 24,
      forceRefresh: false,
      hideShorts: true,
      hideViewed: false,
      hideDismissed: true,
      hideSaved: true,
      beforeDate: "2000-01-01",
    });

    expect(page.videos.map((video) => video.seen)).toEqual([true]);
    expect(mocks.userProperties.getPropertiesCalls - before).toBe(1);
  });
});

describe("getFeedPage, timing line", () => {
  it("logs one line naming every stage, with the RSS fetch counts", () => {
    seedFeed([entry("a", "2026-06-20T10:00:00+00:00")]);
    seedDurations({ a: "PT10M" });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    getFeedPage({ ...baseOptions, hideShorts: true, hideSaved: true });

    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0][0]);
    expect(line).toMatch(
      /^getFeedPage \d+ms \| channels \d+ms \(1 subscriptions\)/,
    );
    for (const stage of [
      "rss cache",
      "rss fetch",
      "merge",
      "history",
      "watch later",
      "durations",
      "page flags",
      "titles",
    ])
      expect(line).toContain("| " + stage + " ");
    expect(line).toContain("(1 channels, 1 attempts, XML parse ");
    log.mockRestore();
  });
});
