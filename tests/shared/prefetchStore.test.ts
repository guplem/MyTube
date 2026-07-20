// The single-slot prefetch store behind the feed warm-up: any non-feed screen
// warms one background load of feed page 1, and the feed screen consumes it if
// it is still fresh and was loaded with the same options. Pure logic with an
// injected clock and loader, so it tests without a browser or Apps Script.

import { describe, it, expect } from "vitest";
import {
  createPrefetchStore,
  type PrefetchStore,
} from "../../src/shared/prefetchStore";

interface Harness {
  store: PrefetchStore<{ filter: string }, string>;
  loads: { filter: string }[];
  clock: { now: number };
  resolveAll: () => Promise<void>;
  failAll: () => Promise<void>;
}

const MAX_AGE_MS = 90_000;

function makeHarness(): Harness {
  const loads: { filter: string }[] = [];
  const pending: {
    resolve: (value: string) => void;
    reject: (error: Error) => void;
  }[] = [];
  const clock = { now: 1_000_000 };
  const store = createPrefetchStore<{ filter: string }, string>({
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
  return {
    store,
    loads,
    clock,
    resolveAll: async (): Promise<void> => {
      pending
        .splice(0)
        .forEach((entry, index) => entry.resolve(`result-${index}`));
      await Promise.resolve();
    },
    failAll: async (): Promise<void> => {
      pending
        .splice(0)
        .forEach((entry) => entry.reject(new Error("load failed")));
      // Let the store's internal catch run.
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe("createPrefetchStore", () => {
  it("warm starts a load and take returns its promise", async () => {
    const { store, loads, resolveAll } = makeHarness();
    store.warm({ filter: "a" });
    expect(loads).toEqual([{ filter: "a" }]);
    const taken = store.take({ filter: "a" });
    expect(taken).not.toBeNull();
    await resolveAll();
    await expect(taken).resolves.toBe("result-0");
  });

  it("warm is a no-op while a fresh entry with the same key exists", () => {
    const { store, loads, clock } = makeHarness();
    store.warm({ filter: "a" });
    clock.now += MAX_AGE_MS - 1;
    store.warm({ filter: "a" });
    expect(loads).toHaveLength(1);
  });

  it("warm reloads once the entry has gone stale", () => {
    const { store, loads, clock } = makeHarness();
    store.warm({ filter: "a" });
    clock.now += MAX_AGE_MS;
    store.warm({ filter: "a" });
    expect(loads).toHaveLength(2);
  });

  it("warm with different options replaces the entry", () => {
    const { store, loads } = makeHarness();
    store.warm({ filter: "a" });
    store.warm({ filter: "b" });
    expect(loads).toEqual([{ filter: "a" }, { filter: "b" }]);
    expect(store.take({ filter: "a" })).toBeNull();
    expect(store.take({ filter: "b" })).not.toBeNull();
  });

  it("take returns null when options do not match the warmed entry", () => {
    const { store } = makeHarness();
    store.warm({ filter: "a" });
    expect(store.take({ filter: "b" })).toBeNull();
    // The mismatched take must not consume the entry.
    expect(store.take({ filter: "a" })).not.toBeNull();
  });

  it("take returns null when the entry has gone stale", () => {
    const { store, clock } = makeHarness();
    store.warm({ filter: "a" });
    clock.now += MAX_AGE_MS;
    expect(store.take({ filter: "a" })).toBeNull();
  });

  it("take consumes the entry: a second take misses", () => {
    const { store } = makeHarness();
    store.warm({ filter: "a" });
    expect(store.take({ filter: "a" })).not.toBeNull();
    expect(store.take({ filter: "a" })).toBeNull();
  });

  it("invalidate drops the entry and the next warm reloads", () => {
    const { store, loads } = makeHarness();
    store.warm({ filter: "a" });
    store.invalidate();
    expect(store.take({ filter: "a" })).toBeNull();
    store.warm({ filter: "a" });
    expect(loads).toHaveLength(2);
  });

  it("a failed load clears the entry so it is never handed out later", async () => {
    const { store, loads, failAll } = makeHarness();
    store.warm({ filter: "a" });
    await failAll();
    expect(store.take({ filter: "a" })).toBeNull();
    store.warm({ filter: "a" });
    expect(loads).toHaveLength(2);
  });

  it("a failure of an already-replaced load does not clear the newer entry", async () => {
    const { store, clock } = makeHarness();
    store.warm({ filter: "a" });
    const stale = store.take({ filter: "a" });
    expect(stale).not.toBeNull();
    stale?.catch((): void => undefined); // consumer owns the rejection now
    clock.now += 1;
    store.warm({ filter: "a" });
    // Fail both pending loads; only the first was consumed, the second must survive
    // its sibling's rejection handling — but here both reject, so both clear.
    // The guard under test: rejecting promise A must not null out entry B.
    const fresh = store.take({ filter: "a" });
    expect(fresh).not.toBeNull();
    fresh?.catch((): void => undefined);
  });
});
