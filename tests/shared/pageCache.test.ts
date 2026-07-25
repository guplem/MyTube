// The keyed page cache behind the feed: any non-feed screen warms the page the
// feed will open on, and every page the feed actually showed is kept so
// returning to it needs no server call. Pure logic with an injected clock and
// loader, so it tests without a browser or Apps Script.

import { describe, it, expect } from "vitest";
import { createPageCache, type PageCache } from "../../src/shared/pageCache";

interface Harness {
  cache: PageCache<{ filter: string }, string>;
  loads: { filter: string }[];
  clock: { now: number };
  resolveAll: () => Promise<void>;
  failAll: () => Promise<void>;
  failLoad: (index: number) => Promise<void>;
}

const MAX_AGE_MS = 90_000;
const MAX_ENTRIES = 3;

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
    maxEntries: MAX_ENTRIES,
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

  it("warm then use serves the warmed load without starting another", () => {
    const { cache, loads } = makeHarness();
    cache.warm({ filter: "a" });
    cache.use({ filter: "a" });
    expect(loads).toHaveLength(1);
  });

  it("warm is a no-op while a fresh entry with the same key exists", () => {
    const { cache, loads, clock } = makeHarness();
    cache.warm({ filter: "a" });
    clock.now += MAX_AGE_MS - 1;
    cache.warm({ filter: "a" });
    expect(loads).toHaveLength(1);
  });

  it("use reloads once the entry has gone stale", () => {
    const { cache, loads, clock } = makeHarness();
    cache.use({ filter: "a" });
    clock.now += MAX_AGE_MS;
    cache.use({ filter: "a" });
    expect(loads).toEqual([{ filter: "a" }, { filter: "a" }]);
  });

  it("keeps one entry per key, so different options do not evict each other", () => {
    const { cache, loads } = makeHarness();
    cache.use({ filter: "a" });
    cache.use({ filter: "b" });
    cache.use({ filter: "a" });
    expect(loads).toEqual([{ filter: "a" }, { filter: "b" }]);
  });

  it("dropUnserved removes an entry that was only warmed", () => {
    const { cache, loads } = makeHarness();
    cache.warm({ filter: "a" });
    cache.dropUnserved();
    cache.use({ filter: "a" });
    expect(loads).toHaveLength(2);
  });

  it("dropUnserved keeps an entry that use already handed out", () => {
    const { cache, loads } = makeHarness();
    const first = cache.use({ filter: "a" });
    cache.dropUnserved();
    expect(cache.use({ filter: "a" })).toBe(first);
    expect(loads).toHaveLength(1);
  });

  it("clear removes served and unserved entries alike", () => {
    const { cache, loads } = makeHarness();
    cache.use({ filter: "served" });
    cache.warm({ filter: "warmed" });
    cache.clear();
    cache.use({ filter: "served" });
    cache.use({ filter: "warmed" });
    expect(loads).toHaveLength(4);
  });

  it("evicts the entry that loaded first once the cache is full", () => {
    const { cache, loads, clock } = makeHarness();
    for (const filter of ["a", "b", "c", "d"]) {
      cache.use({ filter }); // one key past MAX_ENTRIES
      clock.now += 1;
    }
    expect(loads).toHaveLength(4);
    // The three newest are still cached...
    cache.use({ filter: "b" });
    cache.use({ filter: "c" });
    cache.use({ filter: "d" });
    expect(loads).toHaveLength(4);
    // ...and the one that loaded first is gone, even though use() served it.
    cache.use({ filter: "a" });
    expect(loads).toHaveLength(5);
  });

  it("a failed load is removed so it is never handed out again", async () => {
    const { cache, loads, failAll } = makeHarness();
    const taken = cache.use({ filter: "a" });
    taken.catch((): void => undefined); // the caller owns this rejection
    await failAll();
    cache.use({ filter: "a" });
    expect(loads).toHaveLength(2);
  });

  it("a failure of an already-replaced load does not remove the newer entry", async () => {
    const { cache, loads, clock, failLoad } = makeHarness();
    const stale = cache.use({ filter: "a" });
    stale.catch((): void => undefined);
    clock.now += MAX_AGE_MS; // the entry ages out
    const fresh = cache.use({ filter: "a" }); // second load takes the key
    expect(loads).toHaveLength(2);
    await failLoad(0); // only the first load fails
    expect(cache.use({ filter: "a" })).toBe(fresh);
    expect(loads).toHaveLength(2);
  });
});
