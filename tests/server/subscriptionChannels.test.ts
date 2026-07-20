// Pins the caching policy of getSubscriptionChannels, the first step of every
// feed load. The key case: a corrupt cached value (bad JSON in user properties)
// must be treated as a cache miss — refetch and overwrite — not throw forever
// and permanently break the feed. See youtube.ts getSubscriptionChannels and
// the treat-corrupt-as-miss convention in feed.ts / history.ts.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installAppsScriptMocks,
  uninstallAppsScriptMocks,
  type AppsScriptMocks,
} from "../helpers/appsScriptMock";
import { getSubscriptionChannels } from "../../src/server/youtube";

const CACHE_KEY = "subscriptionChannels";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let mocks: AppsScriptMocks;
let apiCalls: number;

beforeEach(() => {
  mocks = installAppsScriptMocks();
  apiCalls = 0;
});
afterEach(() => {
  uninstallAppsScriptMocks();
});

/** Stub Subscriptions.list to return one channel, counting calls. */
function seedApi(): void {
  mocks.youtube.Subscriptions = {
    list: () => {
      apiCalls += 1;
      return {
        items: [
          {
            snippet: {
              title: "Some Channel",
              resourceId: { channelId: "UC_api" },
            },
          },
        ],
      };
    },
  };
}

/** Stub Subscriptions.list to fail the test if the API is ever hit. */
function seedApiThatMustNotBeCalled(): void {
  mocks.youtube.Subscriptions = {
    list: () => {
      throw new Error("Subscriptions.list should not have been called");
    },
  };
}

describe("getSubscriptionChannels", () => {
  it("treats a corrupt cached value as a cache miss: refetches and overwrites", () => {
    mocks.userProperties.setProperty(CACHE_KEY, "{not json");
    seedApi();

    const channels = getSubscriptionChannels(false);

    expect(channels).toEqual([{ channelId: "UC_api", title: "Some Channel" }]);
    expect(apiCalls).toBe(1);

    // The corrupt value was overwritten with a valid CachedChannels payload.
    const stored = mocks.userProperties.getProperty(CACHE_KEY);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored as string) as {
      fetchedAt: number;
      channels: { channelId: string; title: string }[];
    };
    expect(parsed.channels).toEqual([
      { channelId: "UC_api", title: "Some Channel" },
    ]);
  });

  it("returns a fresh cached value without calling the API", () => {
    mocks.userProperties.setProperty(
      CACHE_KEY,
      JSON.stringify({
        fetchedAt: Date.now(),
        channels: [{ channelId: "UC_cached", title: "Cached Channel" }],
      }),
    );
    seedApiThatMustNotBeCalled();

    const channels = getSubscriptionChannels(false);

    expect(channels).toEqual([
      { channelId: "UC_cached", title: "Cached Channel" },
    ]);
    expect(apiCalls).toBe(0);
  });

  it("refetches when the cached value is older than the TTL", () => {
    mocks.userProperties.setProperty(
      CACHE_KEY,
      JSON.stringify({
        fetchedAt: Date.now() - (CACHE_TTL_MS + 60 * 60 * 1000),
        channels: [{ channelId: "UC_stale", title: "Stale Channel" }],
      }),
    );
    seedApi();

    const channels = getSubscriptionChannels(false);

    expect(channels).toEqual([{ channelId: "UC_api", title: "Some Channel" }]);
    expect(apiCalls).toBe(1);
  });

  it("bypasses a fresh cache when forceRefresh is true", () => {
    mocks.userProperties.setProperty(
      CACHE_KEY,
      JSON.stringify({
        fetchedAt: Date.now(),
        channels: [{ channelId: "UC_cached", title: "Cached Channel" }],
      }),
    );
    seedApi();

    const channels = getSubscriptionChannels(true);

    expect(channels).toEqual([{ channelId: "UC_api", title: "Some Channel" }]);
    expect(apiCalls).toBe(1);
  });
});
