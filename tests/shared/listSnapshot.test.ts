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
  carryPreviewTaps,
  previewFlagsOf,
  withWatchLaterChanges,
  listUpdateCountdownLabel,
  LIST_UPDATE_COUNTDOWN_SECONDS,
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
    hideUpcoming: true,
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
      feedSnapshotKey({ ...options, hideUpcoming: false }),
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

describe("carryPreviewTaps", () => {
  it("copies onto the fresh video each flag that a tap on the preview changed", () => {
    const shown: Video[] = [video("a"), video("b")];
    const before = previewFlagsOf(shown);
    shown[0].seen = true;
    shown[1].inWatchLater = true;
    shown[1].dismissed = true;
    const fresh: Video[] = [video("b"), video("a")];

    carryPreviewTaps(before, shown, fresh);

    expect(fresh[1].seen).toBe(true);
    expect(fresh[0].inWatchLater).toBe(true);
    expect(fresh[0].dismissed).toBe(true);
  });

  it("keeps the fresh value of a flag that no tap changed", () => {
    // The server moved on (another device marked it watched): the copy is
    // older, so it must not undo that.
    const shown: Video[] = [video("a", { inWatchLater: true })];
    const before = previewFlagsOf(shown);
    const fresh: Video[] = [video("a", { seen: true, inWatchLater: false })];

    carryPreviewTaps(before, shown, fresh);

    expect(fresh[0].seen).toBe(true);
    expect(fresh[0].inWatchLater).toBe(false);
  });

  it("carries the last tap: a tap and its undo carry nothing", () => {
    const shown: Video[] = [video("a")];
    const before = previewFlagsOf(shown);
    shown[0].seen = true;
    shown[0].seen = false;
    const fresh: Video[] = [video("a", { seen: true })];

    carryPreviewTaps(before, shown, fresh);

    expect(fresh[0].seen).toBe(true);
  });

  it("carries a tap that sets a flag back to false", () => {
    const shown: Video[] = [video("a", { seen: true, inWatchLater: true })];
    const before = previewFlagsOf(shown);
    shown[0].seen = false;
    shown[0].inWatchLater = false;
    const fresh: Video[] = [video("a", { seen: true, inWatchLater: true })];

    carryPreviewTaps(before, shown, fresh);

    expect(fresh[0].seen).toBe(false);
    expect(fresh[0].inWatchLater).toBe(false);
  });

  it("skips a tapped video that the fresh list no longer holds", () => {
    const shown: Video[] = [video("a")];
    const before = previewFlagsOf(shown);
    shown[0].dismissed = true;
    const fresh: Video[] = [video("b")];

    carryPreviewTaps(before, shown, fresh);

    expect(fresh[0].dismissed).toBeUndefined();
  });

  it("reports whether it changed a fresh video", () => {
    const shown: Video[] = [video("a")];
    const before = previewFlagsOf(shown);
    expect(carryPreviewTaps(before, shown, [video("a")])).toBe(false);
    shown[0].seen = true;
    const fresh: Video[] = [video("a")];
    expect(carryPreviewTaps(before, shown, fresh)).toBe(true);
    // A second carry finds the value already in place.
    expect(carryPreviewTaps(before, shown, fresh)).toBe(false);
  });

  it("carries a resume position that the player saved on the preview", () => {
    // A player opened on the preview writes progressSeconds into the
    // preview's own Video, like a tap writes a flag.
    const shown: Video[] = [video("a", { progressSeconds: 30 })];
    const before = previewFlagsOf(shown);
    shown[0].progressSeconds = 95;
    const fresh: Video[] = [video("a", { progressSeconds: 30 })];

    carryPreviewTaps(before, shown, fresh);

    expect(fresh[0].progressSeconds).toBe(95);
  });

  it("carries each preview change once, so a later tap on the fresh video stands", () => {
    // The player can stay open on the preview after the fresh list replaced
    // it, so carries run again after every write. A carry must then copy
    // only what changed on the preview since the last carry.
    const shown: Video[] = [video("a")];
    const before = previewFlagsOf(shown);
    shown[0].seen = true;
    const fresh: Video[] = [video("a")];
    carryPreviewTaps(before, shown, fresh);
    expect(fresh[0].seen).toBe(true);

    fresh[0].seen = false; // the user undid it on the fresh card
    expect(carryPreviewTaps(before, shown, fresh)).toBe(false);
    expect(fresh[0].seen).toBe(false);

    shown[0].inWatchLater = true; // a later tap in the player on the preview
    carryPreviewTaps(before, shown, fresh);
    expect(fresh[0].inWatchLater).toBe(true);
    expect(fresh[0].seen).toBe(false);
  });
});

describe("withWatchLaterChanges", () => {
  const ids = (videos: Video[]): string[] =>
    videos.map((item: Video): string => item.videoId);

  it("appends a video saved on another screen", () => {
    const base: Video[] = [video("a"), video("b")];
    const saved: Video = video("c", { inWatchLater: true });
    expect(ids(withWatchLaterChanges(base, [saved]))).toEqual(["a", "b", "c"]);
  });

  it("drops a video removed on another screen, matched by id", () => {
    // The other screen holds its own object for the same video.
    const base: Video[] = [video("a"), video("b", { inWatchLater: true })];
    const removed: Video = video("b", { inWatchLater: false });
    expect(ids(withWatchLaterChanges(base, [removed]))).toEqual(["a"]);
  });

  it("does not add a video twice", () => {
    const base: Video[] = [video("a", { inWatchLater: true })];
    const saved: Video = video("a", { inWatchLater: true });
    expect(ids(withWatchLaterChanges(base, [saved]))).toEqual(["a"]);
  });

  it("ignores a change that never reached a known state", () => {
    const base: Video[] = [video("a")];
    const unknown: Video = video("b");
    expect(ids(withWatchLaterChanges(base, [unknown]))).toEqual(["a"]);
  });

  it("leaves the base list unchanged", () => {
    const base: Video[] = [video("a")];
    withWatchLaterChanges(base, [video("b", { inWatchLater: true })]);
    expect(ids(base)).toEqual(["a"]);
  });
});

describe("listUpdateCountdownLabel", () => {
  it("counts the new videos and the seconds left", () => {
    expect(listUpdateCountdownLabel(2, 5)).toBe("Showing 2 new videos in 5s");
    expect(listUpdateCountdownLabel(1, 1)).toBe("Showing 1 new video in 1s");
  });

  it("names the change when no video is new", () => {
    expect(listUpdateCountdownLabel(0, 3)).toBe("Updating this list in 3s");
  });

  it("waits a few seconds, not long", () => {
    expect(LIST_UPDATE_COUNTDOWN_SECONDS).toBeGreaterThanOrEqual(3);
    expect(LIST_UPDATE_COUNTDOWN_SECONDS).toBeLessThanOrEqual(10);
  });
});
