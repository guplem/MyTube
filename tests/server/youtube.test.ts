// Duration lookup that powers Shorts detection: parses ISO 8601 durations from
// the Data API, caches them in the shared script cache (a length is the same for
// everyone), and caches a sentinel for ids the API does not return so they are
// not re-queried. See youtube.ts getVideoDurationsSeconds.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installAppsScriptMocks,
  uninstallAppsScriptMocks,
  httpResponse,
  type AppsScriptMocks,
  type FakeHttpResponse,
} from "../helpers/appsScriptMock";
import { getVideoDurationsSeconds } from "../../src/server/youtube";

let mocks: AppsScriptMocks;
let apiCalls: number;

beforeEach(() => {
  mocks = installAppsScriptMocks();
  apiCalls = 0;
});
afterEach(() => {
  uninstallAppsScriptMocks();
});

/** Stub Data API videos.list, counting calls. Only configured ids come back. */
function seedApi(durations: { [videoId: string]: string }): void {
  mocks.youtube.Videos = {
    list: (_part: unknown, params: { id: string }) => {
      apiCalls += 1;
      return {
        items: params.id
          .split(",")
          .filter((id) => id in durations)
          .map((id) => ({ id, contentDetails: { duration: durations[id] } })),
      };
    },
  };
}

describe("getVideoDurationsSeconds", () => {
  it("returns an empty map and makes no API call for no ids", () => {
    seedApi({});
    expect(getVideoDurationsSeconds([])).toEqual({});
    expect(apiCalls).toBe(0);
  });

  it("parses hours, minutes and seconds from ISO 8601 durations", () => {
    seedApi({ a: "PT1H2M3S", b: "PT45S", c: "PT10M", d: "P1DT1H" });
    expect(getVideoDurationsSeconds(["a", "b", "c", "d"])).toEqual({
      a: 3723,
      b: 45,
      c: 600,
      d: 90000,
    });
  });

  it("caches results so a repeat lookup makes no further API call", () => {
    seedApi({ a: "PT60S" });
    getVideoDurationsSeconds(["a"]);
    expect(apiCalls).toBe(1);

    const again = getVideoDurationsSeconds(["a"]);
    expect(again).toEqual({ a: 60 });
    expect(apiCalls).toBe(1); // served from the script cache
  });

  it("caches a sentinel (-1) for ids the API never returns", () => {
    seedApi({ a: "PT60S" }); // "ghost" is deleted/private -> not in the response
    expect(getVideoDurationsSeconds(["a", "ghost"])).toEqual({
      a: 60,
      ghost: -1,
    });

    // The sentinel is cached, so a second lookup of the ghost id is free.
    getVideoDurationsSeconds(["ghost"]);
    expect(apiCalls).toBe(1);
  });
});

const VIDEOS_API = "https://www.googleapis.com/youtube/v3/videos";

/** The ids one parallel Data API request asked for, read from its URL. */
function idsInUrl(url: string): string[] {
  const match = /[?&]id=([^&]*)/.exec(url);
  return match ? decodeURIComponent(match[1]).split(",") : [];
}

/** A Data API videos.list JSON body that knows only these ids. */
function videosBody(
  ids: string[],
  durations: { [videoId: string]: string },
): string {
  return JSON.stringify({
    items: ids
      .filter((id) => id in durations)
      .map((id) => ({ id, contentDetails: { duration: durations[id] } })),
  });
}

function manyIds(count: number): string[] {
  return Array.from({ length: count }, (_unused, index) => `v${index}`);
}

describe("getVideoDurationsSeconds, parallel lookup", () => {
  it("asks every missing batch of 50 in ONE fetchAll, with the user's token", () => {
    seedApi({}); // a Videos.list call here would mean the parallel path was skipped
    const ids = manyIds(120);
    const durations: { [videoId: string]: string } = {};
    for (const id of ids) durations[id] = "PT5M";
    const fetchAllCalls: { url: string; headers?: object }[][] = [];
    mocks.fetchAll = (requests) => {
      fetchAllCalls.push(requests);
      return requests.map((request) =>
        httpResponse(200, videosBody(idsInUrl(request.url), durations)),
      );
    };

    const result = getVideoDurationsSeconds(ids);

    expect(fetchAllCalls).toHaveLength(1);
    const requests = fetchAllCalls[0];
    expect(requests.map((request) => idsInUrl(request.url).length)).toEqual([
      50, 50, 20,
    ]);
    for (const request of requests) {
      expect(request.url.startsWith(VIDEOS_API + "?")).toBe(true);
      expect(request.url).toContain("part=contentDetails");
      expect(request.headers).toEqual({
        Authorization: "Bearer fake-oauth-token",
      });
    }
    expect(apiCalls).toBe(0);
    expect(result.v0).toBe(300);
    expect(result.v119).toBe(300);
  });

  it("falls back to the advanced service only for a batch whose request failed", () => {
    const ids = manyIds(60);
    const durations: { [videoId: string]: string } = {};
    for (const id of ids) durations[id] = "PT30S";
    seedApi(durations);
    mocks.fetchAll = (requests) =>
      requests.map((request, index): FakeHttpResponse =>
        index === 0
          ? httpResponse(200, videosBody(idsInUrl(request.url), durations))
          : httpResponse(403, "forbidden"),
      );

    const result = getVideoDurationsSeconds(ids);

    expect(apiCalls).toBe(1); // only the second batch, v50..v59
    expect(result.v0).toBe(30);
    expect(result.v59).toBe(30);
  });

  it("falls back to the advanced service when the parallel fetch throws", () => {
    seedApi({ a: "PT2M" });
    mocks.fetchAll = () => {
      throw new Error("UrlFetch quota exceeded");
    };

    expect(getVideoDurationsSeconds(["a"])).toEqual({ a: 120 });
    expect(apiCalls).toBe(1);
  });

  it("caches nothing for a batch that failed both ways, and keeps the others", () => {
    const ids = manyIds(60);
    const durations: { [videoId: string]: string } = {};
    for (const id of ids) durations[id] = "PT30S";
    mocks.youtube.Videos = {
      list: () => {
        apiCalls += 1;
        throw new Error("quota exceeded");
      },
    };
    mocks.fetchAll = (requests) =>
      requests.map((request, index): FakeHttpResponse =>
        index === 0
          ? httpResponse(200, videosBody(idsInUrl(request.url), durations))
          : httpResponse(500, ""),
      );

    const result = getVideoDurationsSeconds(ids);

    expect(result.v0).toBe(30);
    // A failed batch is unknown, not "no duration": no sentinel, so a later
    // load asks again.
    expect(result.v59).toBeUndefined();
    expect(mocks.scriptCache.get("dur:v59")).toBeNull();
    expect(mocks.scriptCache.get("dur:v0")).toBe("30");
  });
});
