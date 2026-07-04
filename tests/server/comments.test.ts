// Comments server path: maps the top-level comment of each thread to
// VideoComment and returns the next-page token. The error contract matters —
// a "disabled comments" error is a normal empty result, but any other error
// (e.g. a missing youtube.force-ssl scope) must be re-thrown so it surfaces in
// the UI instead of hiding as "No comments". See youtube.ts getComments and the
// CLAUDE.md gotcha on the force-ssl scope.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installAppsScriptMocks,
  uninstallAppsScriptMocks,
  type AppsScriptMocks,
} from "../helpers/appsScriptMock";
import { getComments } from "../../src/server/youtube";

// CommentThreads is not part of the shared FakeYouTube type (that helper is
// owned by other plans); widen locally to attach the stub this test needs.
type YouTubeWithComments = AppsScriptMocks["youtube"] & {
  CommentThreads?: { list: (...args: unknown[]) => unknown };
};

let mocks: AppsScriptMocks;

beforeEach(() => {
  mocks = installAppsScriptMocks();
});
afterEach(() => {
  uninstallAppsScriptMocks();
});

describe("getComments", () => {
  it("maps the top-level comment fields and returns nextPageToken", () => {
    (mocks.youtube as YouTubeWithComments).CommentThreads = {
      list: () => ({
        items: [
          {
            snippet: {
              topLevelComment: {
                snippet: {
                  authorDisplayName: "Alice",
                  authorProfileImageUrl: "alice.jpg",
                  textDisplay: "Nice video",
                  likeCount: 7,
                  publishedAt: "2026-06-20T10:00:00Z",
                },
              },
            },
          },
        ],
        nextPageToken: "NEXT",
      }),
    };

    expect(getComments("v1", "relevance", "")).toEqual({
      comments: [
        {
          author: "Alice",
          authorImageUrl: "alice.jpg",
          text: "Nice video",
          likeCount: 7,
          publishedAt: "2026-06-20T10:00:00Z",
        },
      ],
      nextPageToken: "NEXT",
    });
  });

  it("sends pageToken: undefined on the first page (called with '')", () => {
    let sentPageToken: unknown = "sentinel";
    (mocks.youtube as YouTubeWithComments).CommentThreads = {
      list: (_part: unknown, params: { pageToken?: string }) => {
        sentPageToken = params.pageToken;
        return { items: [] };
      },
    };

    getComments("v1", "time", "");

    expect(sentPageToken).toBeUndefined();
  });

  it("returns an empty page when comments are disabled", () => {
    (mocks.youtube as YouTubeWithComments).CommentThreads = {
      list: () => {
        throw new Error("The video identified by <videoId> has disabled comments.");
      },
    };

    expect(getComments("v1", "relevance", "")).toEqual({ comments: [], nextPageToken: "" });
  });

  it("re-throws any other error (e.g. a missing scope)", () => {
    (mocks.youtube as YouTubeWithComments).CommentThreads = {
      list: () => {
        throw new Error("Request had insufficient authentication scopes.");
      },
    };

    expect(() => getComments("v1", "relevance", "")).toThrow();
  });
});
