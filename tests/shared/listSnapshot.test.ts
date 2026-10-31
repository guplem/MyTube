// The policy behind the instant preview of a list: which saved copy may be
// shown, and whether the fresh list may replace it without moving a card. See
// src/shared/listSnapshot.ts.

import { describe, expect, it } from "vitest";
import {
  LIST_SNAPSHOT_MAX_AGE_MS,
  feedSnapshotKey,
  feedSnapshotPage,
  freshListMovesNothing,
  newVideoCount,
  parseListSnapshot,
  watchLaterSnapshotVideos,
  type ListSnapshot,
} from "../../src/shared/listSnapshot";
import type { Video } from "../../src/shared/video";
import type { FeedPageOptions } from "../../src/shared/feed";

function video(videoId: string, flags: Partial<Video> = {}): Video {
  return {
    videoId,
    title: videoId,
    channelId: "C",
    channelTitle: "Channel",
    thumbnailUrl: "",
    publishedAt: "2026-10-01T10:00:00+00:00",
    seen: false,
    ...flags,
  };
}

const NOW = 1_800_000_000_000;

function snapshot(overrides: Partial<ListSnapshot> = {}): string {
  const value: ListSnapshot = {
    account: "user-1",
    key: "watchlater",
    savedAt: NOW - 1000,
    videos: [video("a")],
    total: 1,
    ...overrides,
  };
  return JSON.stringify(value);
}

describe("parseListSnapshot", () => {
  it("returns the saved copy of this account and key", () => {
    const parsed = parseListSnapshot(snapshot(), "user-1", "watchlater", NOW);
    expect(parsed?.videos.map((item) => item.videoId)).toEqual(["a"]);
    expect(parsed?.total).toBe(1);
  });

  it("never shows another account's copy (one browser, two Google accounts)", () => {
    expect(parseListSnapshot(snapshot(), "user-2", "watchlater", NOW)).toBe(
      null,
    );
  });

  it("refuses every copy when the account is unknown", () => {
    expect(
      parseListSnapshot(snapshot({ account: "" }), "", "watchlater", NOW),
    ).toBe(null);
  });

  it("never shows a copy saved for other filters", () => {
    expect(parseListSnapshot(snapshot(), "user-1", "feed:x", NOW)).toBe(null);
  });

  it("drops a copy older than the maximum age", () => {
    const old = snapshot({ savedAt: NOW - LIST_SNAPSHOT_MAX_AGE_MS - 1 });
    expect(parseListSnapshot(old, "user-1", "watchlater", NOW)).toBe(null);
    const edge = snapshot({ savedAt: NOW - LIST_SNAPSHOT_MAX_AGE_MS + 1 });
    expect(parseListSnapshot(edge, "user-1", "watchlater", NOW)).not.toBe(null);
  });

  it("drops missing, broken or wrongly shaped copies", () => {
    expect(parseListSnapshot(null, "user-1", "watchlater", NOW)).toBe(null);
    expect(parseListSnapshot("{not json", "user-1", "watchlater", NOW)).toBe(
      null,
    );
    expect(
      parseListSnapshot(
        JSON.stringify({ account: "user-1", key: "watchlater", savedAt: NOW }),
        "user-1",
        "watchlater",
        NOW,
      ),
    ).toBe(null);
  });

  it("drops an empty copy: an empty preview would only flash", () => {
    expect(
      parseListSnapshot(
        snapshot({ videos: [], total: 0 }),
        "user-1",
        "watchlater",
        NOW,
      ),
    ).toBe(null);
  });
});

describe("freshListMovesNothing", () => {
  it("is true for the same videos in the same order", () => {
    expect(freshListMovesNothing(["a", "b"], ["a", "b"])).toBe(true);
  });

  it("is true when the fresh list only adds videos at the end", () => {
    expect(freshListMovesNothing(["a", "b"], ["a", "b", "c"])).toBe(true);
  });

  it("is true when the fresh list only loses videos at the end", () => {
    expect(freshListMovesNothing(["a", "b", "c"], ["a", "b"])).toBe(true);
  });

  it("is false when a new video arrives at the top", () => {
    expect(freshListMovesNothing(["a", "b"], ["n", "a", "b"])).toBe(false);
  });

  it("is false when a video in the middle is gone", () => {
    expect(freshListMovesNothing(["a", "b", "c"], ["a", "c"])).toBe(false);
  });

  it("is false when the order changed", () => {
    expect(freshListMovesNothing(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("looks only at the cards on show when given their count", () => {
    // Page 1 shows two cards; a change on a later page moves none of them.
    expect(freshListMovesNothing(["a", "b", "c"], ["a", "b", "x"], 2)).toBe(
      true,
    );
    expect(freshListMovesNothing(["a", "b", "c"], ["a", "x", "c"], 2)).toBe(
      false,
    );
  });
});

describe("newVideoCount", () => {
  it("counts the fresh videos the preview did not show", () => {
    expect(newVideoCount(["a", "b"], ["n", "m", "a"])).toBe(2);
    expect(newVideoCount(["a", "b"], ["b", "a"])).toBe(0);
  });
});

describe("watchLaterSnapshotVideos", () => {
  it("leaves out the videos the user removed this session", () => {
    const kept = watchLaterSnapshotVideos([
      video("a", { inWatchLater: true }),
      video("b", { inWatchLater: false }),
      video("c", { inWatchLater: true, seen: true }),
    ]);
    expect(kept.map((item) => item.videoId)).toEqual(["a", "c"]);
  });
});

describe("feed snapshots", () => {
  const options: FeedPageOptions = {
    page: 0,
    pageSize: 24,
    forceRefresh: false,
    hideShorts: true,
    hideViewed: false,
    hideDismissed: true,
    hideSaved: true,
    beforeDate: "2026-07-31",
  };

  it("keys on the filters and the page size, not on the moving default date", () => {
    expect(feedSnapshotKey(options)).toBe(
      feedSnapshotKey({ ...options, beforeDate: "2026-08-01" }),
    );
    expect(feedSnapshotKey(options)).toBe(
      feedSnapshotKey({ ...options, forceRefresh: true }),
    );
    expect(feedSnapshotKey(options)).not.toBe(
      feedSnapshotKey({ ...options, hideShorts: false }),
    );
    expect(feedSnapshotKey(options)).not.toBe(
      feedSnapshotKey({ ...options, pageSize: 48 }),
    );
  });

  it("leaves out the videos the user dealt with, and takes them off the total", () => {
    const page = feedSnapshotPage(
      [
        video("a"),
        video("b", { dismissed: true }),
        video("c", { inWatchLater: true }),
        video("d", { seen: true }),
      ],
      100,
      options,
    );
    expect(page.videos.map((item) => item.videoId)).toEqual(["a", "d"]);
    expect(page.total).toBe(98);
  });
});
