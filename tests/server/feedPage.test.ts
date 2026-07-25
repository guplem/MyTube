// Core concept: server-side paging and filtering of the subscriptions feed.
// getFeedPage builds the full feed, flags seen/dismissed, applies the
// hideViewed / hideDismissed / hideSaved / beforeDate / hideShorts filters, then
// returns a single page plus the total. Shorts are detected by duration
// (<= 180s), not a flag. See CLAUDE.md and PLAN.md section 5.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

/** Stub the Data API duration lookup: videoId -> ISO 8601 duration. */
function seedDurations(durations: { [videoId: string]: string }): void {
  mocks.youtube.Videos = {
    list: (_part: unknown, params: { id: string }) => ({
      items: params.id
        .split(",")
        .filter((id) => id in durations)
        .map((id) => ({ id, contentDetails: { duration: durations[id] } })),
    }),
  };
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
    // A stray PlaylistItems.list call would throw, proving we never reach it.
    mocks.youtube.PlaylistItems = {
      list: () => {
        throw new Error("should not be called");
      },
      insert: () => ({}),
      remove: () => ({}),
    };

    const page = getFeedPage({ ...baseOptions, hideSaved: true });

    expect(page.videos.map((v) => v.videoId)).toEqual(["a", "b"]);
    expect(page.total).toBe(2);
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
