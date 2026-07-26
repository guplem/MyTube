// The single-slot page cache behind the feed: any non-feed screen warms the page
// the feed will open on, and the feed keeps the one page it is showing so
// returning to it needs no server call. Pure logic with an injected clock and
// loader, so it tests without a browser or Apps Script.

import { describe, it, expect } from "vitest";
import { createPageCache, type PageCache } from "../../src/shared/pageCache";

interface Harness {
  cache: PageCache<{ filter: string }, string>;
  loads: { filter: string }[];
  clock: { now: number };
  resolveAll: () => Promise<void>;
  resolveLoad: (index: number) => Promise<void>;
  failAll: () => Promise<void>;
  failLoad: (index: number) => Promise<void>;
}

const MAX_AGE_MS = 90_000;

function makeHarness(): Harness {
  const loads: { filter: string }[] = [];
  // Indexed by load order and never spliced, so a test can fail one specific
  // load. Settling an already-settled promise is a no-op, so resolveAll/failAll
  // can walk the whole array.
  const pending: {
    resolve: (value: string) => void;
    reject: (error: Error) => void;
  }[] = [];
  const clock = { now: 1_000_000 };
  const cache = createPageCache<{ filter: string }, string>({
    load: (options): Promise<string> => {
      loads.push(options);
      return new Promise<string>((resolve, reject) =>
        pending.push({ resolve, reject }),
      );
    },
    key: (options): string => JSON.stringify(options),
    now: (): number => clock.now,
    maxAgeMs: MAX_AGE_MS,
  });
  // Two microtask ticks, so the cache's own .catch has run before assertions.
  const settle = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  };
  return {
    cache,
    loads,
    clock,
    resolveAll: async (): Promise<void> => {
      pending.forEach((entry, index) => entry.resolve(`result-${index}`));
      await settle();
    },
    resolveLoad: async (index: number): Promise<void> => {
      pending[index]?.resolve(`result-${index}`);
      await settle();
    },
    failAll: async (): Promise<void> => {
      pending.forEach((entry) => entry.reject(new Error("load failed")));
      await settle();
    },
    failLoad: async (index: number): Promise<void> => {
      pending[index]?.reject(new Error("load failed"));
      await settle();
    },
  };
}

describe("createPageCache", () => {
  it("use starts a load and returns its promise", async () => {
    const { cache, loads, resolveAll } = makeHarness();
    const taken = cache.use({ filter: "a" });
    expect(loads).toEqual([{ filter: "a" }]);
    await resolveAll();
    await expect(taken).resolves.toBe("result-0");
  });

  it("use does not consume: a second use returns the same promise", () => {
    const { cache, loads } = makeHarness();
    const first = cache.use({ filter: "a" });
    const second = cache.use({ filter: "a" });
    expect(second).toBe(first);
    expect(loads).toHaveLength(1);
  });

  // Pins the "still fresh" side of the window; the test below pins the other
  // side, so together they fix the boundary at exactly maxAgeMs.
  it("use starts no second load while the kept page is still fresh", () => {
    const { cache, loads, clock } = makeHarness();
    cache.use({ filter: "a" });
    clock.now += MAX_AGE_MS - 1;
    cache.use({ filter: "a" });
    expect(loads).toHaveLength(1);
  });

  it("use reloads once the kept page has gone stale", () => {
    const { cache, loads, clock } = makeHarness();
    cache.use({ filter: "a" });
    clock.now += MAX_AGE_MS;
    cache.use({ filter: "a" });
    expect(loads).toEqual([{ filter: "a" }, { filter: "a" }]);
  });

  // The whole point of the single slot: two entries can never hold two copies of
  // the same video and disagree about its flags.
  it("use with a different key replaces the kept page", () => {
    const { cache, loads } = makeHarness();
    cache.use({ filter: "a" });
    cache.use({ filter: "b" });
    cache.use({ filter: "a" });
    expect(loads).toEqual([{ filter: "a" }, { filter: "b" }, { filter: "a" }]);
  });

  it("clear drops the kept page", () => {
    const { cache, loads } = makeHarness();
    cache.use({ filter: "a" });
    cache.clear();
    cache.use({ filter: "a" });
    expect(loads).toHaveLength(2);
  });

  it("a failed load is dropped so it is never handed out again", async () => {
    const { cache, loads, failAll } = makeHarness();
    const taken = cache.use({ filter: "a" });
    taken.catch((): void => undefined); // the caller owns this rejection
    await failAll();
    cache.use({ filter: "a" });
    expect(loads).toHaveLength(2);
  });

  it("a failure of an already-replaced load does not drop the newer page", async () => {
    const { cache, loads, clock, failLoad } = makeHarness();
    const stale = cache.use({ filter: "a" });
    stale.catch((): void => undefined);
    clock.now += MAX_AGE_MS; // the entry ages out
    const fresh = cache.use({ filter: "a" }); // second load takes the slot
    expect(loads).toHaveLength(2);
    await failLoad(0); // only the first load fails
    expect(cache.use({ filter: "a" })).toBe(fresh);
    expect(loads).toHaveLength(2);
  });
});

// resolved() is how a caller asks "is the object I am holding still the page you
// hold?" without keeping its own reference, which would go on claiming identity
// after the cache had already swapped the page out.
describe("createPageCache resolved", () => {
  it("is null with nothing held", () => {
    const { cache } = makeHarness();
    expect(cache.resolved()).toBeNull();
  });

  it("is null while the kept load is still in flight", () => {
    const { cache } = makeHarness();
    cache.use({ filter: "a" });
    expect(cache.resolved()).toBeNull();
  });

  it("reports the kept page once its load resolves", async () => {
    const { cache, resolveAll } = makeHarness();
    cache.use({ filter: "a" });
    await resolveAll();
    expect(cache.resolved()).toBe("result-0");
  });

  it("is null after a failed load", async () => {
    const { cache, failAll } = makeHarness();
    cache.use({ filter: "a" }).catch((): void => undefined);
    await failAll();
    expect(cache.resolved()).toBeNull();
  });

  it("is null after clear", async () => {
    const { cache, resolveAll } = makeHarness();
    cache.use({ filter: "a" });
    await resolveAll();
    cache.clear();
    expect(cache.resolved()).toBeNull();
  });

  // The hole this closes: a background load replaces the kept page while another
  // screen still holds the old one. The old page must stop being recognised the
  // instant it is replaced, not when the replacement finishes loading.
  it("is null again the moment a replacement load starts", async () => {
    const { cache, resolveAll } = makeHarness();
    cache.use({ filter: "a" });
    await resolveAll();
    cache.use({ filter: "b" });
    expect(cache.resolved()).toBeNull();
  });

  it("reports the replacement, not the page it replaced", async () => {
    const { cache, resolveAll } = makeHarness();
    cache.use({ filter: "a" });
    await resolveAll();
    cache.use({ filter: "b" });
    await resolveAll();
    expect(cache.resolved()).toBe("result-1");
  });

  it("ignores a replaced load that resolves late", async () => {
    const { cache, clock, resolveLoad } = makeHarness();
    cache.use({ filter: "a" }); // load 0
    clock.now += MAX_AGE_MS; // it ages out
    cache.use({ filter: "a" }); // load 1 takes the slot
    await resolveLoad(1);
    await resolveLoad(0);
    expect(cache.resolved()).toBe("result-1");
  });
});
