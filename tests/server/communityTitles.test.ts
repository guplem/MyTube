// Core concept: the lists that main.ts returns carry the DeArrow community
// title on the same Video objects that the adapters built (ADR 0008), and a
// DeArrow failure leaves every list intact with its YouTube titles.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installAppsScriptMocks,
  uninstallAppsScriptMocks,
  httpResponse,
  type AppsScriptMocks,
} from "../helpers/appsScriptMock";
import { channelRss, makeVideo, type RssEntry } from "../helpers/fixtures";
import { getFeedPage, getHistory } from "../../src/server/main";
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

function rssEntry(videoId: string): RssEntry {
  return {
    videoId,
    title: "YouTube " + videoId,
    channelId: "C1",
    channelTitle: "One",
    publishedAt: "2026-06-20T10:00:00+00:00",
  };
}

/** Serves the channel RSS, and answers DeArrow with `dearrow` per URL. */
function seed(dearrow: (url: string) => ReturnType<typeof httpResponse>): void {
  mocks.userProperties.setProperty(
    "subscriptionChannels",
    JSON.stringify({
      fetchedAt: Date.now(),
      channels: [{ channelId: "C1", title: "One" }],
    }),
  );
  const rss = channelRss([rssEntry(WITH_TITLE), rssEntry(WITHOUT_TITLE)]);
  mocks.fetchAll = (requests) =>
    requests.map((request) =>
      request.url.startsWith(DEARROW_BASE)
        ? dearrow(request.url)
        : httpResponse(200, rss),
    );
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
});
