// Playlist normalization: getPlaylists lists the user's own playlists (paged,
// skipping id-less items), and getPlaylistVideos maps PlaylistItems to Video[]
// with specific fallbacks — the actual uploader over the playlist channel, the
// real upload date over the added-to-playlist date, and a thumbnail preference
// order. Pins the exact fallbacks so plan 003 refactors safely. See youtube.ts
// getPlaylists/getPlaylistVideos/bestThumbnailUrl.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installAppsScriptMocks,
  uninstallAppsScriptMocks,
  type AppsScriptMocks,
} from "../helpers/appsScriptMock";
import { getPlaylists, getPlaylistVideos } from "../../src/server/youtube";

let mocks: AppsScriptMocks;

beforeEach(() => {
  mocks = installAppsScriptMocks();
});
afterEach(() => {
  uninstallAppsScriptMocks();
});

describe("getPlaylists", () => {
  it("follows nextPageToken across two pages and concatenates", () => {
    mocks.youtube.Playlists = {
      list: (_part: unknown, params: { pageToken?: string }) => {
        if (!params.pageToken) {
          return {
            items: [{ id: "PL1", snippet: { title: "One" }, contentDetails: { itemCount: 3 } }],
            nextPageToken: "PAGE2",
          };
        }
        return {
          items: [{ id: "PL2", snippet: { title: "Two" }, contentDetails: { itemCount: 5 } }],
        };
      },
      insert: () => ({}),
    };

    expect(getPlaylists()).toEqual([
      { playlistId: "PL1", title: "One", itemCount: 3 },
      { playlistId: "PL2", title: "Two", itemCount: 5 },
    ]);
  });

  it("skips an item with no id", () => {
    mocks.youtube.Playlists = {
      list: () => ({
        items: [
          { snippet: { title: "No id" }, contentDetails: { itemCount: 1 } },
          { id: "PL2", snippet: { title: "Two" }, contentDetails: { itemCount: 5 } },
        ],
      }),
      insert: () => ({}),
    };

    expect(getPlaylists()).toEqual([{ playlistId: "PL2", title: "Two", itemCount: 5 }]);
  });
});

describe("getPlaylistVideos", () => {
  it("prefers videoOwnerChannelId/Title over the playlist snippet channel", () => {
    mocks.youtube.PlaylistItems = {
      list: () => ({
        items: [
          {
            id: "item-1",
            snippet: {
              title: "Video",
              channelId: "PLAYLIST_OWNER",
              channelTitle: "Playlist Owner",
              videoOwnerChannelId: "UPLOADER",
              videoOwnerChannelTitle: "Uploader",
              resourceId: { videoId: "v1" },
              thumbnails: {},
            },
            contentDetails: { videoId: "v1" },
          },
        ],
      }),
      insert: () => ({}),
      remove: () => ({}),
    };

    const [video] = getPlaylistVideos("PL");
    expect(video.channelId).toBe("UPLOADER");
    expect(video.channelTitle).toBe("Uploader");
  });

  it("prefers contentDetails.videoPublishedAt, falling back to snippet.publishedAt", () => {
    mocks.youtube.PlaylistItems = {
      list: () => ({
        items: [
          {
            id: "item-1",
            snippet: {
              title: "Has upload date",
              publishedAt: "2020-01-01T00:00:00Z",
              resourceId: { videoId: "v1" },
              thumbnails: {},
            },
            contentDetails: { videoId: "v1", videoPublishedAt: "2019-06-15T00:00:00Z" },
          },
          {
            id: "item-2",
            snippet: {
              title: "No upload date",
              publishedAt: "2021-03-03T00:00:00Z",
              resourceId: { videoId: "v2" },
              thumbnails: {},
            },
            contentDetails: { videoId: "v2" },
          },
        ],
      }),
      insert: () => ({}),
      remove: () => ({}),
    };

    const videos = getPlaylistVideos("PL");
    expect(videos[0].publishedAt).toBe("2019-06-15T00:00:00Z"); // real upload date wins
    expect(videos[1].publishedAt).toBe("2021-03-03T00:00:00Z"); // falls back to added-to-playlist date
  });

  it("picks the thumbnail in medium → default → high → '' order", () => {
    mocks.youtube.PlaylistItems = {
      list: () => ({
        items: [
          {
            id: "item-medium",
            snippet: {
              title: "medium",
              resourceId: { videoId: "v-medium" },
              thumbnails: {
                medium: { url: "medium.jpg" },
                default: { url: "default.jpg" },
                high: { url: "high.jpg" },
              },
            },
            contentDetails: { videoId: "v-medium" },
          },
          {
            id: "item-default",
            snippet: {
              title: "default",
              resourceId: { videoId: "v-default" },
              thumbnails: { default: { url: "default.jpg" }, high: { url: "high.jpg" } },
            },
            contentDetails: { videoId: "v-default" },
          },
          {
            id: "item-high",
            snippet: {
              title: "high",
              resourceId: { videoId: "v-high" },
              thumbnails: { high: { url: "high.jpg" } },
            },
            contentDetails: { videoId: "v-high" },
          },
          {
            id: "item-none",
            snippet: { title: "none", resourceId: { videoId: "v-none" }, thumbnails: {} },
            contentDetails: { videoId: "v-none" },
          },
        ],
      }),
      insert: () => ({}),
      remove: () => ({}),
    };

    expect(getPlaylistVideos("PL").map((v) => v.thumbnailUrl)).toEqual([
      "medium.jpg",
      "default.jpg",
      "high.jpg",
      "",
    ]);
  });

  it("skips an item with neither resourceId.videoId nor contentDetails.videoId", () => {
    mocks.youtube.PlaylistItems = {
      list: () => ({
        items: [
          { id: "item-bad", snippet: { title: "No video id", thumbnails: {} }, contentDetails: {} },
          {
            id: "item-good",
            snippet: { title: "Good", resourceId: { videoId: "v1" }, thumbnails: {} },
            contentDetails: { videoId: "v1" },
          },
        ],
      }),
      insert: () => ({}),
      remove: () => ({}),
    };

    expect(getPlaylistVideos("PL").map((v) => v.videoId)).toEqual(["v1"]);
  });
});
