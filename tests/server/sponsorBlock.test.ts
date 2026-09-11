// Core concept: sponsor segments from SponsorBlock, the public crowd database
// of "skip this part" time ranges. The lookup asks for a 4-character hash
// prefix, never the video id itself, and caches the answer in the shared script
// cache because the segments are the same for every viewer.

import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installAppsScriptMocks,
  uninstallAppsScriptMocks,
  httpResponse,
  type AppsScriptMocks,
} from "../helpers/appsScriptMock";
import { getSponsorSegments } from "../../src/server/sponsorBlock";

let mocks: AppsScriptMocks;

beforeEach(() => {
  mocks = installAppsScriptMocks();
});
afterEach(() => {
  uninstallAppsScriptMocks();
});

const VIDEO_ID = "dQw4w9WgXcQ";
const OTHER_VIDEO_ID = "abcdefghijk";

function hashPrefix(videoId: string): string {
  return createHash("sha256").update(videoId).digest("hex").slice(0, 4);
}

/** SponsorBlock's answer shape: every video that shares the requested prefix. */
function apiBody(
  entries: { videoID: string; segments: unknown[] }[],
): ReturnType<typeof httpResponse> {
  return httpResponse(200, JSON.stringify(entries));
}

function skipSegment(
  category: string,
  start: number,
  end: number,
): { category: string; actionType: string; segment: number[] } {
  return { category, actionType: "skip", segment: [start, end] };
}

describe("getSponsorSegments", () => {
  it("asks for the hash prefix, never the plain video id", () => {
    const urls: string[] = [];
    mocks.fetchAll = (requests) => {
      urls.push(requests[0].url);
      return [apiBody([])];
    };

    getSponsorSegments(VIDEO_ID);

    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain(
      "https://sponsor.ajay.app/api/skipSegments/" + hashPrefix(VIDEO_ID),
    );
    expect(urls[0]).toContain("category=sponsor");
    expect(urls[0]).toContain("category=selfpromo");
    expect(urls[0]).not.toContain(VIDEO_ID);
  });

  it("returns only the requested video's segments, normalized", () => {
    mocks.fetchAll = () => [
      apiBody([
        {
          videoID: OTHER_VIDEO_ID,
          segments: [skipSegment("sponsor", 0, 999)],
        },
        {
          videoID: VIDEO_ID,
          segments: [
            skipSegment("selfpromo", 120, 140),
            skipSegment("sponsor", 10, 30),
            { category: "sponsor", actionType: "mute", segment: [200, 210] },
          ],
        },
      ]),
    ];

    expect(getSponsorSegments(VIDEO_ID)).toEqual([
      { category: "sponsor", startSeconds: 10, endSeconds: 30 },
      { category: "selfpromo", startSeconds: 120, endSeconds: 140 },
    ]);
  });

  it("returns an empty list when the prefix holds no entry for this video", () => {
    mocks.fetchAll = () => [
      apiBody([
        { videoID: OTHER_VIDEO_ID, segments: [skipSegment("sponsor", 0, 10)] },
      ]),
    ];

    expect(getSponsorSegments(VIDEO_ID)).toEqual([]);
  });

  it("returns an empty list on a non-200 response", () => {
    mocks.fetchAll = () => [httpResponse(404, "Not Found")];
    expect(getSponsorSegments(VIDEO_ID)).toEqual([]);
  });

  it("returns an empty list on an unparseable body", () => {
    mocks.fetchAll = () => [httpResponse(200, "<html>nope</html>")];
    expect(getSponsorSegments(VIDEO_ID)).toEqual([]);
  });

  it("returns an empty list when the request itself throws", () => {
    mocks.fetchAll = () => {
      throw new Error("network down");
    };
    expect(getSponsorSegments(VIDEO_ID)).toEqual([]);
  });

  it("does not look the same video up twice while the cache entry lives", () => {
    let calls = 0;
    mocks.fetchAll = () => {
      calls++;
      return [
        apiBody([
          { videoID: VIDEO_ID, segments: [skipSegment("sponsor", 10, 30)] },
        ]),
      ];
    };

    const first = getSponsorSegments(VIDEO_ID);
    const second = getSponsorSegments(VIDEO_ID);

    expect(calls).toBe(1);
    expect(second).toEqual(first);
  });

  it("caches the empty answer too, so a video with no segments is asked once", () => {
    let calls = 0;
    mocks.fetchAll = () => {
      calls++;
      return [apiBody([])];
    };

    getSponsorSegments(VIDEO_ID);
    getSponsorSegments(VIDEO_ID);

    expect(calls).toBe(1);
  });

  it("does not cache a failed lookup", () => {
    let calls = 0;
    mocks.fetchAll = () => {
      calls++;
      return [httpResponse(500, "")];
    };

    getSponsorSegments(VIDEO_ID);
    getSponsorSegments(VIDEO_ID);

    expect(calls).toBe(2);
  });

  it("returns an empty list for an empty video id, without a request", () => {
    let calls = 0;
    mocks.fetchAll = () => {
      calls++;
      return [apiBody([])];
    };

    expect(getSponsorSegments("")).toEqual([]);
    expect(calls).toBe(0);
  });
});
