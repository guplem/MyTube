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

// The URL the lookup must build, written out in full. A substring check would
// pass for a longer or shorter prefix, which sends the request to the wrong
// bucket.
const CATEGORY_QUERY = "?category=sponsor&category=selfpromo";
const VIDEO_ID_URL =
  "https://sponsor.ajay.app/api/skipSegments/5f6b" + CATEGORY_QUERY;
// "abcdefghijk" hashes to ca2f..., so its first byte is 202, which Apps Script
// reports as the signed byte -54. The code must bring it back into 0..255.
const OTHER_VIDEO_ID_URL =
  "https://sponsor.ajay.app/api/skipSegments/ca2f" + CATEGORY_QUERY;

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

    expect(urls).toEqual([VIDEO_ID_URL]);
    // The prefix is exactly 4 hex characters of sha256(videoId).
    const prefix = urls[0]
      .replace("https://sponsor.ajay.app/api/skipSegments/", "")
      .replace(CATEGORY_QUERY, "");
    expect(prefix).toHaveLength(4);
    expect(prefix).toBe(hashPrefix(VIDEO_ID));
  });

  it("builds the right hex for a hash byte above 127", () => {
    const urls: string[] = [];
    mocks.fetchAll = (requests) => {
      urls.push(requests[0].url);
      return [apiBody([])];
    };

    getSponsorSegments(OTHER_VIDEO_ID);

    expect(urls).toEqual([OTHER_VIDEO_ID_URL]);
    expect(hashPrefix(OTHER_VIDEO_ID)).toBe("ca2f"); // golden value
  });

  it("mutes HTTP exceptions, so a non-200 answer does not throw", () => {
    const requests: { url: string; muteHttpExceptions?: boolean }[] = [];
    mocks.fetchAll = (sent) => {
      requests.push(sent[0]);
      return [apiBody([])];
    };

    getSponsorSegments(VIDEO_ID);

    expect(requests[0].muteHttpExceptions).toBe(true);
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

  it("returns an empty list on a 404, the service's 'nothing here' answer", () => {
    mocks.fetchAll = () => [httpResponse(404, "Not Found")];
    expect(getSponsorSegments(VIDEO_ID)).toEqual([]);
  });

  it("returns an empty list on any other non-200 response", () => {
    mocks.fetchAll = () => [httpResponse(500, "Server Error")];
    expect(getSponsorSegments(VIDEO_ID)).toEqual([]);
  });

  it("caches a 404: it is a definitive 'no segments', not a failure", () => {
    let calls = 0;
    mocks.fetchAll = () => {
      calls++;
      return [httpResponse(404, "Not Found")];
    };

    getSponsorSegments(VIDEO_ID);
    getSponsorSegments(VIDEO_ID);

    expect(calls).toBe(1);
  });

  it("returns an empty list on an unparseable body, and does not cache it", () => {
    let calls = 0;
    mocks.fetchAll = () => {
      calls++;
      return [httpResponse(200, "<html>nope</html>")];
    };

    expect(getSponsorSegments(VIDEO_ID)).toEqual([]);
    getSponsorSegments(VIDEO_ID);

    expect(calls).toBe(2);
  });

  it("does not cache a 200 whose body is not an array", () => {
    let calls = 0;
    mocks.fetchAll = () => {
      calls++;
      return [httpResponse(200, JSON.stringify({ error: "broken" }))];
    };

    expect(getSponsorSegments(VIDEO_ID)).toEqual([]);
    getSponsorSegments(VIDEO_ID);

    expect(calls).toBe(2);
  });

  it("merges every entry the bucket holds for this video", () => {
    mocks.fetchAll = () => [
      apiBody([
        { videoID: VIDEO_ID, segments: [skipSegment("sponsor", 10, 30)] },
        { videoID: OTHER_VIDEO_ID, segments: [skipSegment("sponsor", 0, 999)] },
        { videoID: VIDEO_ID, segments: [skipSegment("selfpromo", 120, 140)] },
      ]),
    ];

    expect(getSponsorSegments(VIDEO_ID)).toEqual([
      { category: "sponsor", startSeconds: 10, endSeconds: 30 },
      { category: "selfpromo", startSeconds: 120, endSeconds: 140 },
    ]);
  });

  it("keeps a fetched answer when the cache write fails", () => {
    mocks.fetchAll = () => [
      apiBody([
        { videoID: VIDEO_ID, segments: [skipSegment("sponsor", 10, 30)] },
      ]),
    ];
    mocks.scriptCache.put = () => {
      throw new Error("cache unavailable");
    };

    expect(getSponsorSegments(VIDEO_ID)).toEqual([
      { category: "sponsor", startSeconds: 10, endSeconds: 30 },
    ]);
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

  // The cache entry is the UNBOUNDED list, and each caller bounds it by its
  // own duration after the read. The first caller must not fix the bound for
  // everyone: the player passes an undefined duration whenever the length
  // lookup failed, and a wrong bound would reach every viewer for 6 hours.
  it("bounds a cached list by each caller's own duration", () => {
    mocks.fetchAll = () => [
      apiBody([
        { videoID: VIDEO_ID, segments: [skipSegment("sponsor", 0, 99999)] },
      ]),
    ];

    getSponsorSegments(VIDEO_ID); // no duration: caches the unbounded list

    expect(getSponsorSegments(VIDEO_ID, 600)).toEqual([]);
  });

  it("keeps the full list for a later caller after a bounded first call", () => {
    mocks.fetchAll = () => [
      apiBody([
        { videoID: VIDEO_ID, segments: [skipSegment("sponsor", 0, 99999)] },
      ]),
    ];
    const full = [{ category: "sponsor", startSeconds: 0, endSeconds: 99999 }];

    expect(getSponsorSegments(VIDEO_ID, 600)).toEqual([]);

    expect(getSponsorSegments(VIDEO_ID, 200000)).toEqual(full);
    expect(getSponsorSegments(VIDEO_ID)).toEqual(full);
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
