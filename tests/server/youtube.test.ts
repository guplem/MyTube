// Duration lookup that powers Shorts detection: parses ISO 8601 durations from
// the Data API, caches them in the shared script cache (a length is the same for
// everyone), and caches a sentinel for ids the API does not return so they are
// not re-queried. See youtube.ts getVideoDurationsSeconds.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installAppsScriptMocks,
  uninstallAppsScriptMocks,
  type AppsScriptMocks,
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
    expect(getVideoDurationsSeconds(["a", "ghost"])).toEqual({ a: 60, ghost: -1 });

    // The sentinel is cached, so a second lookup of the ghost id is free.
    getVideoDurationsSeconds(["ghost"]);
    expect(apiCalls).toBe(1);
  });
});
