// Core concept: community titles from DeArrow, the crowd database of less
// clickbait video titles. The lookup asks for a 4-character hash prefix, never
// the video id itself, sends one batched request per distinct prefix, and
// caches each video's answer in the shared script cache. Any failure returns
// no title and caches nothing.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installAppsScriptMocks,
  uninstallAppsScriptMocks,
  httpResponse,
  type AppsScriptMocks,
} from "../helpers/appsScriptMock";
import { createHash } from "node:crypto";
import { getCommunityTitles } from "../../src/server/dearrow";

let mocks: AppsScriptMocks;

beforeEach(() => {
  mocks = installAppsScriptMocks();
});
afterEach(() => {
  uninstallAppsScriptMocks();
});

const BASE = "https://sponsor.ajay.app/api/branding/";
// "dQw4w9WgXcQ" and "same0091278" both hash to 5f6b..., so they share one
// bucket and one request.
const VIDEO_ID = "dQw4w9WgXcQ";
const SAME_BUCKET_ID = "same0091278";
// "abcdefghijk" hashes to ca2f..., so its first byte is 202, which Apps Script
// reports as the signed byte -54. The code must bring it back into 0..255.
const OTHER_VIDEO_ID = "abcdefghijk";
const VIDEO_ID_URL = BASE + "5f6b";
const OTHER_VIDEO_ID_URL = BASE + "ca2f";

type TitleEntry = {
  title: string;
  original: boolean;
  votes: number;
  locked: boolean;
};

function title(
  text: string,
  votes: number,
  locked: boolean = false,
): TitleEntry {
  return { title: text, original: false, votes, locked };
}

/** DeArrow's answer shape: every video in the bucket, keyed by video id. */
function bucket(entries: {
  [videoId: string]: TitleEntry[];
}): ReturnType<typeof httpResponse> {
  const body: { [videoId: string]: unknown } = {};
  for (const id of Object.keys(entries)) {
    body[id] = { titles: entries[id], thumbnails: [], randomTime: 0.5 };
  }
  return httpResponse(200, JSON.stringify(body));
}

/** The DeArrow bucket prefix of a video id, computed off the code under test. */
function prefixOf(videoId: string): string {
  return createHash("sha256").update(videoId, "utf8").digest("hex").slice(0, 4);
}

/** `count` 11-character ids that each hash to a different bucket. */
function idsInDistinctBuckets(count: number): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (let n = 0; ids.length < count; n++) {
    const id = ("id" + n).padEnd(11, "x");
    const prefix = prefixOf(id);
    if (seen.has(prefix)) continue;
    seen.add(prefix);
    ids.push(id);
  }
  return ids;
}

/** Routes each request URL to a response, and records every URL asked. */
function respondWith(byUrl: {
  [url: string]: ReturnType<typeof httpResponse>;
}): string[][] {
  const calls: string[][] = [];
  mocks.fetchAll = (requests) => {
    calls.push(requests.map((request) => request.url));
    return requests.map(
      (request) => byUrl[request.url] ?? httpResponse(500, ""),
    );
  };
  return calls;
}

describe("getCommunityTitles", () => {
  it("asks for the hash prefix, one request per distinct prefix", () => {
    const calls = respondWith({
      [VIDEO_ID_URL]: bucket({}),
      [OTHER_VIDEO_ID_URL]: bucket({}),
    });

    getCommunityTitles([VIDEO_ID, SAME_BUCKET_ID, OTHER_VIDEO_ID]);

    expect(calls).toEqual([[VIDEO_ID_URL, OTHER_VIDEO_ID_URL]]);
  });

  it("mutes HTTP exceptions, so a non-200 answer does not throw", () => {
    const sent: { muteHttpExceptions?: boolean }[] = [];
    mocks.fetchAll = (requests) => {
      sent.push(...requests);
      return requests.map(() => bucket({}));
    };

    getCommunityTitles([VIDEO_ID]);

    expect(sent.map((request) => request.muteHttpExceptions)).toEqual([true]);
  });

  it("sends no request without video ids", () => {
    const calls = respondWith({});

    expect(getCommunityTitles([])).toEqual({});
    expect(getCommunityTitles([""])).toEqual({});
    expect(calls).toEqual([]);
  });

  it("returns the chosen title of each asked video, and only those", () => {
    respondWith({
      [VIDEO_ID_URL]: bucket({
        [VIDEO_ID]: [title("Voted", 9), title("Locked", 0, true)],
        [SAME_BUCKET_ID]: [title(">iPhone review", 2), title("Other", 1)],
        notAskedFor: [title("Not mine", 5)],
      }),
      [OTHER_VIDEO_ID_URL]: bucket({ [OTHER_VIDEO_ID]: [title("Down", -1)] }),
    });

    expect(
      getCommunityTitles([VIDEO_ID, SAME_BUCKET_ID, OTHER_VIDEO_ID]),
    ).toEqual({ [VIDEO_ID]: "Locked", [SAME_BUCKET_ID]: "iPhone review" });
  });

  it("caches every answer per video, so a second call sends nothing", () => {
    const calls = respondWith({
      [VIDEO_ID_URL]: bucket({ [VIDEO_ID]: [title("Better", 1)] }),
      // SAME_BUCKET_ID is missing from its bucket, OTHER_VIDEO_ID has an
      // empty list: both are a definitive "no title" and are cached.
      [OTHER_VIDEO_ID_URL]: bucket({ [OTHER_VIDEO_ID]: [] }),
    });
    const ids = [VIDEO_ID, SAME_BUCKET_ID, OTHER_VIDEO_ID];

    const first = getCommunityTitles(ids);
    const second = getCommunityTitles(ids);

    expect(first).toEqual({ [VIDEO_ID]: "Better" });
    expect(second).toEqual(first);
    expect(calls).toHaveLength(1);
  });

  it("treats a 404 as an empty bucket and caches it", () => {
    const calls = respondWith({ [VIDEO_ID_URL]: httpResponse(404, "") });

    expect(getCommunityTitles([VIDEO_ID])).toEqual({});
    expect(getCommunityTitles([VIDEO_ID])).toEqual({});
    expect(calls).toHaveLength(1);
  });

  it("does not cache a failed bucket, and asks for it again", () => {
    const calls = respondWith({ [VIDEO_ID_URL]: httpResponse(400, "") });

    expect(getCommunityTitles([VIDEO_ID])).toEqual({});
    expect(getCommunityTitles([VIDEO_ID])).toEqual({});
    expect(calls).toEqual([[VIDEO_ID_URL], [VIDEO_ID_URL]]);
  });

  it("does not cache a body that is not a bucket object", () => {
    const calls = respondWith({
      [VIDEO_ID_URL]: httpResponse(200, "[]"),
    });

    getCommunityTitles([VIDEO_ID]);
    getCommunityTitles([VIDEO_ID]);

    expect(calls).toHaveLength(2);
  });

  it("keeps the other bucket's titles when one bucket fails", () => {
    const calls = respondWith({
      [VIDEO_ID_URL]: httpResponse(500, ""),
      [OTHER_VIDEO_ID_URL]: bucket({ [OTHER_VIDEO_ID]: [title("Calm", 0)] }),
    });

    expect(getCommunityTitles([VIDEO_ID, OTHER_VIDEO_ID])).toEqual({
      [OTHER_VIDEO_ID]: "Calm",
    });
    // Only the failed bucket is asked again.
    getCommunityTitles([VIDEO_ID, OTHER_VIDEO_ID]);
    expect(calls[1]).toEqual([VIDEO_ID_URL]);
  });

  it("returns no title and caches nothing when the fetch throws", () => {
    let attempts = 0;
    mocks.fetchAll = () => {
      attempts++;
      throw new Error("network down");
    };

    expect(getCommunityTitles([VIDEO_ID])).toEqual({});
    expect(getCommunityTitles([VIDEO_ID])).toEqual({});
    expect(attempts).toBe(2);
  });

  it("serves a cached title with no request", () => {
    mocks.scriptCache.put("da:" + VIDEO_ID, JSON.stringify("From cache"));
    mocks.scriptCache.put("da:" + OTHER_VIDEO_ID, JSON.stringify(""));
    const calls = respondWith({});

    expect(getCommunityTitles([VIDEO_ID, OTHER_VIDEO_ID])).toEqual({
      [VIDEO_ID]: "From cache",
    });
    expect(calls).toEqual([]);
  });

  it("still returns the fetched titles when the cache write fails", () => {
    respondWith({
      [VIDEO_ID_URL]: bucket({ [VIDEO_ID]: [title("Better", 1)] }),
    });
    mocks.scriptCache.putAll = () => {
      throw new Error("cache full");
    };

    expect(getCommunityTitles([VIDEO_ID])).toEqual({ [VIDEO_ID]: "Better" });
  });

  it("asks at most 50 buckets per call, the first ids first", () => {
    const ids = idsInDistinctBuckets(200);
    const calls: string[][] = [];
    mocks.fetchAll = (requests) => {
      calls.push(requests.map((request) => request.url));
      return requests.map((request) => {
        const prefix = request.url.slice(BASE.length);
        const id = ids.find((candidate) => prefixOf(candidate) === prefix)!;
        return bucket({ [id]: [title("Calm " + id, 1)] });
      });
    };

    const first = getCommunityTitles(ids);
    const second = getCommunityTitles(ids);

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(ids.slice(0, 50).map((id) => BASE + prefixOf(id)));
    expect(Object.keys(first).sort()).toEqual(ids.slice(0, 50).sort());
    // The misses past the cap were not cached, so the next call asks for them.
    expect(calls[1]).toEqual(
      ids.slice(50, 100).map((id) => BASE + prefixOf(id)),
    );
    expect(Object.keys(second).sort()).toEqual(ids.slice(0, 100).sort());
  });

  it("stores each answer as a JSON string, so no title is not empty", () => {
    respondWith({
      [VIDEO_ID_URL]: bucket({ [VIDEO_ID]: [title("Better", 1)] }),
      [OTHER_VIDEO_ID_URL]: httpResponse(404, ""),
    });

    getCommunityTitles([VIDEO_ID, OTHER_VIDEO_ID]);

    expect(mocks.scriptCache.get("da:" + VIDEO_ID)).toBe('"Better"');
    expect(mocks.scriptCache.get("da:" + OTHER_VIDEO_ID)).toBe('""');
  });

  it("treats a cached value that is not a JSON string as a miss", () => {
    mocks.scriptCache.put("da:" + VIDEO_ID, "not json");
    mocks.scriptCache.put("da:" + OTHER_VIDEO_ID, "42");
    const calls = respondWith({
      [VIDEO_ID_URL]: bucket({ [VIDEO_ID]: [title("Better", 1)] }),
      [OTHER_VIDEO_ID_URL]: httpResponse(404, ""),
    });

    expect(getCommunityTitles([VIDEO_ID, OTHER_VIDEO_ID])).toEqual({
      [VIDEO_ID]: "Better",
    });
    expect(calls).toEqual([[VIDEO_ID_URL, OTHER_VIDEO_ID_URL]]);
  });

  it("returns no inherited value for an id such as constructor", () => {
    respondWith({});

    const titles = getCommunityTitles(["constructor"]);

    expect(titles["constructor"]).toBeUndefined();
  });

  it("keeps the first bucket's titles when the second bucket fails", () => {
    const calls = respondWith({
      [VIDEO_ID_URL]: bucket({ [VIDEO_ID]: [title("Calm", 0)] }),
      [OTHER_VIDEO_ID_URL]: httpResponse(500, ""),
    });

    expect(getCommunityTitles([VIDEO_ID, OTHER_VIDEO_ID])).toEqual({
      [VIDEO_ID]: "Calm",
    });
    getCommunityTitles([VIDEO_ID, OTHER_VIDEO_ID]);
    expect(calls[1]).toEqual([OTHER_VIDEO_ID_URL]);
  });

  it("reads more than 100 cached ids in chunks of at most 100 keys", () => {
    const ids = idsInDistinctBuckets(150);
    for (const id of ids)
      mocks.scriptCache.put("da:" + id, JSON.stringify("Cached " + id));
    const keysPerGetAll = spyOnKeyCounts("getAll");
    const calls = respondWith({});

    const titles = getCommunityTitles(ids);

    expect(calls).toEqual([]);
    expect(Object.keys(titles)).toHaveLength(150);
    expect(titles[ids[149]]).toBe("Cached " + ids[149]);
    expect(keysPerGetAll).toEqual([100, 50]);
  });

  it("writes more than 100 fetched ids in chunks of at most 100 keys", () => {
    // 34 buckets of 3 ids: 102 misses, under the cap of 50 requests.
    const ids = idsInSharedBuckets(34, 3);
    const keysPerPutAll = spyOnKeyCounts("putAll");
    const calls = respondWith({});
    mocks.fetchAll = (requests) => {
      calls.push(requests.map((request) => request.url));
      return requests.map(() => httpResponse(404, ""));
    };

    getCommunityTitles(ids);
    getCommunityTitles(ids);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(34);
    expect(keysPerPutAll).toEqual([100, 2]);
  });
});

/** Records the key count of each call to one script cache method. */
function spyOnKeyCounts(method: "getAll" | "putAll"): number[] {
  const counts: number[] = [];
  const cache = mocks.scriptCache;
  if (method === "getAll") {
    const original = cache.getAll.bind(cache);
    cache.getAll = (keys: string[]) => {
      counts.push(keys.length);
      return original(keys);
    };
  } else {
    const original = cache.putAll.bind(cache);
    cache.putAll = (values: { [key: string]: string }, ttl?: number) => {
      counts.push(Object.keys(values).length);
      original(values, ttl);
    };
  }
  return counts;
}

/** `buckets` groups of `perBucket` 11-character ids that share a prefix. */
function idsInSharedBuckets(buckets: number, perBucket: number): string[] {
  const byPrefix: Map<string, string[]> = new Map();
  const full: string[][] = [];
  for (let n = 0; full.length < buckets; n++) {
    const id = ("sb" + n).padEnd(11, "y");
    const group = byPrefix.get(prefixOf(id)) ?? [];
    if (group.length === perBucket) continue;
    group.push(id);
    byPrefix.set(prefixOf(id), group);
    if (group.length === perBucket) full.push(group);
  }
  return full.flat();
}
