// Core concept: the "new uploads" feed. Builds Video[] from each subscription's
// RSS, newest first, with a freshness cache, retry/backoff on throttling, and a
// last-good fallback so a transient failure shows stale videos instead of
// dropping the channel. Exercises the real getUploadsFeed against fake Apps
// Script globals (RSS over a fake UrlFetchApp, parsed by a real XML parser).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installAppsScriptMocks,
  uninstallAppsScriptMocks,
  httpResponse,
  type AppsScriptMocks,
  type FakeHttpResponse,
} from "../helpers/appsScriptMock";
import { channelRss } from "../helpers/fixtures";
import { getUploadsFeed } from "../../src/server/feed";

let mocks: AppsScriptMocks;

beforeEach(() => {
  mocks = installAppsScriptMocks();
});
afterEach(() => {
  uninstallAppsScriptMocks();
});

/** Seed the per-user subscription-channel cache so getUploadsFeed needs no API. */
function seedChannels(channels: { channelId: string; title: string }[]): void {
  mocks.userProperties.setProperty(
    "subscriptionChannels",
    JSON.stringify({ fetchedAt: Date.now(), channels }),
  );
}

/** UrlFetchApp.fetchAll responder driven by a per-channel response map. */
function respondPerChannel(map: { [channelId: string]: FakeHttpResponse }): void {
  mocks.fetchAll = (requests) =>
    requests.map((req) => {
      const channelId = req.url.split("channel_id=")[1];
      return map[channelId] ?? httpResponse(404, "");
    });
}

describe("getUploadsFeed", () => {
  it("parses each channel's RSS into Video[] with the fields mapped correctly", () => {
    seedChannels([{ channelId: "C1", title: "Chan One" }]);
    respondPerChannel({
      C1: httpResponse(
        200,
        channelRss([
          {
            videoId: "v1",
            title: "Hello World",
            channelId: "C1",
            channelTitle: "Chan One",
            thumbnailUrl: "https://i.ytimg.com/vi/v1/hq.jpg",
            publishedAt: "2026-06-20T10:00:00+00:00",
          },
        ]),
      ),
    });

    const feed = getUploadsFeed(false);

    expect(feed.totalChannels).toBe(1);
    expect(feed.failedChannels).toBe(0);
    expect(feed.videos).toHaveLength(1);
    expect(feed.videos[0]).toEqual({
      videoId: "v1",
      title: "Hello World",
      channelId: "C1",
      channelTitle: "Chan One",
      thumbnailUrl: "https://i.ytimg.com/vi/v1/hq.jpg",
      publishedAt: "2026-06-20T10:00:00+00:00",
      seen: false,
    });
  });

  it("merges all channels newest first", () => {
    seedChannels([
      { channelId: "C1", title: "One" },
      { channelId: "C2", title: "Two" },
    ]);
    respondPerChannel({
      C1: httpResponse(
        200,
        channelRss([
          { videoId: "old", title: "Old", channelId: "C1", channelTitle: "One", publishedAt: "2026-06-01T00:00:00+00:00" },
          { videoId: "newest", title: "Newest", channelId: "C1", channelTitle: "One", publishedAt: "2026-06-25T00:00:00+00:00" },
        ]),
      ),
      C2: httpResponse(
        200,
        channelRss([
          { videoId: "mid", title: "Mid", channelId: "C2", channelTitle: "Two", publishedAt: "2026-06-10T00:00:00+00:00" },
        ]),
      ),
    });

    const feed = getUploadsFeed(false);

    expect(feed.videos.map((v) => v.videoId)).toEqual(["newest", "mid", "old"]);
  });

  it("reuses the freshness cache on the next load without refetching", () => {
    seedChannels([{ channelId: "C1", title: "One" }]);
    respondPerChannel({
      C1: httpResponse(200, channelRss([{ videoId: "v1", title: "V1", channelId: "C1", channelTitle: "One", publishedAt: "2026-06-20T00:00:00+00:00" }])),
    });
    getUploadsFeed(false); // warms the cache

    let refetched = false;
    mocks.fetchAll = (requests) => {
      refetched = true;
      return requests.map(() => httpResponse(404, ""));
    };
    const feed = getUploadsFeed(false);

    expect(refetched).toBe(false);
    expect(feed.videos.map((v) => v.videoId)).toEqual(["v1"]);
  });

  it("retries throttled channels with backoff and reports them as failed", () => {
    seedChannels([
      { channelId: "OK", title: "Ok" },
      { channelId: "BAD", title: "Bad" },
    ]);
    respondPerChannel({
      OK: httpResponse(200, channelRss([{ videoId: "ok1", title: "Ok1", channelId: "OK", channelTitle: "Ok", publishedAt: "2026-06-20T00:00:00+00:00" }])),
      // BAD is absent from the map -> always 404
    });

    const feed = getUploadsFeed(false);

    expect(feed.totalChannels).toBe(2);
    expect(feed.failedChannels).toBe(1);
    expect(feed.videos.map((v) => v.videoId)).toEqual(["ok1"]);
    // MAX_FETCH_ATTEMPTS is 3, so a persistently failing channel triggers 2 backoff sleeps.
    expect(mocks.sleeps).toHaveLength(2);
  });

  it("falls back to the last-good copy when a forced refresh fails", () => {
    seedChannels([{ channelId: "C1", title: "One" }]);
    // A forced refresh also re-fetches the subscription list from the API.
    mocks.youtube.Subscriptions = {
      list: () => ({ items: [{ snippet: { title: "One", resourceId: { channelId: "C1" } } }] }),
    };
    respondPerChannel({
      C1: httpResponse(200, channelRss([{ videoId: "good", title: "Good", channelId: "C1", channelTitle: "One", publishedAt: "2026-06-20T00:00:00+00:00" }])),
    });
    getUploadsFeed(false); // stores the last-good copy

    mocks.fetchAll = (requests) => requests.map(() => httpResponse(500, "")); // YouTube throttles
    const feed = getUploadsFeed(true); // force refresh, bypassing the freshness cache

    expect(feed.failedChannels).toBe(1);
    expect(feed.videos.map((v) => v.videoId)).toEqual(["good"]); // stale, but not dropped
  });

  it("returns an empty feed when there are no subscriptions", () => {
    seedChannels([]);
    const feed = getUploadsFeed(false);
    expect(feed).toEqual({ videos: [], failedChannels: 0, totalChannels: 0 });
  });
});
