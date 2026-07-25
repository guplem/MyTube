// In-memory cache of ONE loaded page, plus a background warm-up path. Built for
// the feed — a non-feed screen warms the page the feed will open on, and the
// feed keeps the page it is showing so returning to it costs no server call —
// but generic and dependency-injected (clock + loader) so the policy is testable
// on Node without a browser or Apps Script.
//
// Policies, chosen for the feed:
// - ONE entry, ever. Serving a different key replaces the kept page. Two
//   entries could otherwise hold two Video objects for the same video and
//   disagree about its flags, and a page nobody is looking at would keep
//   serving a `total` and a membership list the server has moved past.
// - Fresh window: an entry older than maxAgeMs is loaded again, not served.
// - Reusable: use() hands out the same promise again and again. The caller
//   keeps the objects it resolved to, so the page it rendered stays correct
//   while it mutates them in place.
// - A failed load is dropped, so a rejected promise is never handed out later
//   (a caller already holding it sees the rejection, same as a direct call
//   failing).

export interface PageCacheConfig<O, T> {
  /** Starts the load for the given options. */
  load: (options: O) => Promise<T>;
  /** Serializes options to the identity key the kept page is matched on. */
  key: (options: O) => string;
  /** Clock, injected for tests (Date.now in production). */
  now: () => number;
  /** How long the kept page stays usable after its load started. */
  maxAgeMs: number;
}

export interface PageCache<O, T> {
  /** Starts a background load for these options; no-op when the kept page
   *  already matches and is fresh. */
  warm: (options: O) => void;
  /** The kept page for these options, loading it on a miss. A different key
   *  replaces the kept page, so only one is ever held. */
  use: (options: O) => Promise<T>;
  /** Drops the kept page. */
  clear: () => void;
}

interface Entry<T> {
  key: string;
  promise: Promise<T>;
  startedAt: number;
}

export function createPageCache<O, T>(
  config: PageCacheConfig<O, T>,
): PageCache<O, T> {
  let entry: Entry<T> | null = null;

  function fresh(key: string): Entry<T> | null {
    if (!entry || entry.key !== key) return null;
    return config.now() - entry.startedAt < config.maxAgeMs ? entry : null;
  }

  function start(key: string, options: O): Entry<T> {
    const next: Entry<T> = {
      key,
      promise: config.load(options),
      startedAt: config.now(),
    };
    entry = next;
    // Drop a failed load — but only while it is still the kept page, so a stale
    // rejection never wipes out a newer one.
    next.promise.catch((): void => {
      if (entry === next) entry = null;
    });
    return next;
  }

  return {
    warm: (options: O): void => {
      const key = config.key(options);
      if (fresh(key)) return;
      start(key, options);
    },
    use: (options: O): Promise<T> => {
      const key = config.key(options);
      return (fresh(key) ?? start(key, options)).promise;
    },
    clear: (): void => {
      entry = null;
    },
  };
}
