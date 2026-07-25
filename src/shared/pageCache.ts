// Keyed in-memory cache of loads, with a background warm-up path. Built for the
// feed — a non-feed screen warms the page the feed will open on, and every page
// the feed showed is kept so returning to it costs no server call — but generic
// and dependency-injected (clock + loader) so the policy is testable on Node
// without a browser or Apps Script.
//
// Policies, chosen for the feed:
// - One entry per key, capped at maxEntries; going over evicts the entry whose
//   load started first.
// - Fresh window: an entry older than maxAgeMs is dropped instead of served.
// - Reusable: use() hands out the same promise again and again. The caller
//   keeps the objects it resolved to, so a page it already rendered stays
//   correct while it mutates them in place.
// - Served vs unserved: dropUnserved() removes only entries use() never
//   returned. Nobody holds those, so a change made elsewhere leaves them stale.
//   A served entry is live and stays.
// - A failed load is removed, so a rejected promise is never handed out later
//   (a caller already holding it sees the rejection, same as a direct call
//   failing).

export interface PageCacheConfig<O, T> {
  /** Starts the load for the given options. */
  load: (options: O) => Promise<T>;
  /** Serializes options to the identity key entries are matched on. */
  key: (options: O) => string;
  /** Clock, injected for tests (Date.now in production). */
  now: () => number;
  /** How long an entry stays usable after its load started. */
  maxAgeMs: number;
  /** Most entries kept at once; going over evicts the oldest. */
  maxEntries: number;
}

export interface PageCache<O, T> {
  /** Starts a background load for these options; no-op if one is fresh already. */
  warm: (options: O) => void;
  /** The cached promise for these options, starting a load on a miss. Marks the
   *  entry served, so it survives dropUnserved(). */
  use: (options: O) => Promise<T>;
  /** Drops every entry use() has never returned. */
  dropUnserved: () => void;
  /** Drops every entry, served or not. */
  clear: () => void;
}

interface Entry<T> {
  promise: Promise<T>;
  startedAt: number;
  /** True once use() handed this promise to a caller. */
  served: boolean;
}

export function createPageCache<O, T>(
  config: PageCacheConfig<O, T>,
): PageCache<O, T> {
  // Insertion order is load-start order (every insert deletes the key first),
  // so the first key is always the oldest entry.
  const entries = new Map<string, Entry<T>>();

  function fresh(key: string): Entry<T> | null {
    const entry = entries.get(key);
    if (!entry) return null;
    if (config.now() - entry.startedAt >= config.maxAgeMs) {
      entries.delete(key);
      return null;
    }
    return entry;
  }

  function start(key: string, options: O): Entry<T> {
    const entry: Entry<T> = {
      promise: config.load(options),
      startedAt: config.now(),
      served: false,
    };
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > config.maxEntries) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      entries.delete(oldest.value);
    }
    // Drop a failed load — but only while this entry still holds the key, so a
    // stale rejection never wipes out a newer one.
    entry.promise.catch((): void => {
      if (entries.get(key) === entry) entries.delete(key);
    });
    return entry;
  }

  return {
    warm: (options: O): void => {
      const key = config.key(options);
      if (fresh(key)) return;
      start(key, options);
    },
    use: (options: O): Promise<T> => {
      const key = config.key(options);
      const entry = fresh(key) ?? start(key, options);
      entry.served = true;
      return entry.promise;
    },
    dropUnserved: (): void => {
      for (const [key, entry] of entries)
        if (!entry.served) entries.delete(key);
    },
    clear: (): void => {
      entries.clear();
    },
  };
}
