// Single-slot prefetch store: warm() starts a background load keyed on its
// options, take() hands the in-flight (or settled) promise to the one consumer
// that asked with the same options while it is still fresh. Built for the feed
// warm-up — any non-feed screen warms feed page 1 so opening the feed is
// instant — but generic and dependency-injected (clock + loader) so the policy
// is testable on Node without a browser or Apps Script.
//
// Policies, chosen for the feed:
// - Single slot: only the latest warmed options are kept; warming with
//   different options replaces the entry.
// - Fresh window: an entry older than maxAgeMs is ignored (its seen/dismissed/
//   Watch Later flags may have drifted) and warm() loads again.
// - Single use: take() consumes the entry, so a stashed snapshot is never
//   served twice; the next warm() starts a new load.
// - A failed load clears the slot so a rejected promise is never handed out
//   later (a consumer already holding it sees the rejection, same as a direct
//   call failing).

export interface PrefetchStoreConfig<O, T> {
  /** Starts the background load for the given options. */
  load: (options: O) => Promise<T>;
  /** Serializes options to the identity key entries are matched on. */
  key: (options: O) => string;
  /** Clock, injected for tests (Date.now in production). */
  now: () => number;
  /** How long a warmed entry stays usable. */
  maxAgeMs: number;
}

export interface PrefetchStore<O, T> {
  /** Ensures a load for these options is warm; no-op if one is fresh already. */
  warm: (options: O) => void;
  /** The warmed promise if it matches and is fresh (consumes it), else null. */
  take: (options: O) => Promise<T> | null;
  /** Drops the entry (e.g. after a mutation makes the snapshot stale). */
  invalidate: () => void;
}

interface Entry<T> {
  key: string;
  promise: Promise<T>;
  startedAt: number;
}

export function createPrefetchStore<O, T>(
  config: PrefetchStoreConfig<O, T>,
): PrefetchStore<O, T> {
  let entry: Entry<T> | null = null;

  function isFresh(candidate: Entry<T>): boolean {
    return config.now() - candidate.startedAt < config.maxAgeMs;
  }

  return {
    warm: (options: O): void => {
      const key = config.key(options);
      if (entry && entry.key === key && isFresh(entry)) return;
      const next: Entry<T> = {
        key,
        promise: config.load(options),
        startedAt: config.now(),
      };
      entry = next;
      // Clear a failed load — but only if this entry still occupies the slot,
      // so a stale rejection never wipes out a newer warm.
      next.promise.catch((): void => {
        if (entry === next) entry = null;
      });
    },
    take: (options: O): Promise<T> | null => {
      if (!entry || entry.key !== config.key(options) || !isFresh(entry))
        return null;
      const { promise } = entry;
      entry = null;
      return promise;
    },
    invalidate: (): void => {
      entry = null;
    },
  };
}
