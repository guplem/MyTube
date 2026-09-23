// Community titles from DeArrow, the public crowd database of better (less
// clickbait) video titles. The SponsorBlock project runs it on the same
// server, so this file follows src/server/sponsorBlock.ts: no key and no
// account, only HTTPS through the script.external_request scope.
//
// Three rules shape this file:
//
// 1. PRIVACY. The request carries only the first 4 hex characters of
//    sha256(videoId), so the service sees a bucket of many videos and never
//    learns which ones this app lists. It answers with every video in that
//    bucket, and this file picks ours out.
// 2. COST. A community title is the same for every viewer, so it goes in the
//    SHARED script cache, one entry per video. The "no title" answer is cached
//    too: most videos have no title, and they must not be asked twice. Each
//    entry holds JSON.stringify(title), so "no title" is '""' and never an
//    empty value. A read that does not parse to a string is a miss.
//    A failed bucket is never cached, and it never touches another bucket.
// 3. ONE ROUND TRIP. A list asks for its cache misses at once: one
//    UrlFetchApp.fetchAll with one request per distinct hash prefix, and at
//    most MAX_PREFIXES_PER_CALL prefixes.
//
// getDeArrowSubmissions is the single-video lookup for the player Info tab. It
// follows rules 1 and 2 with its own cache entry, but it reports a failed
// lookup instead of "no submissions", because the tab shows the difference.
//
// Every failure returns no title. A missing title means "show the YouTube
// title", which is the pre-feature behaviour, and a list must never depend on
// a third-party service that is slow or down.
//
// Data is CC BY-NC-SA 4.0; the app footer credits DeArrow.

import {
  chooseCommunityTitle,
  parseDeArrowSubmissions,
  type DeArrowSubmission,
  type DeArrowSubmissionsResult,
} from "../shared/dearrow";
import { videoIdHashPrefix } from "./sponsorBlock";

const DEARROW_API_BASE = "https://sponsor.ajay.app/api/branding/";

const DEARROW_CACHE_PREFIX = "da:";
const DEARROW_CACHE_TTL_SECONDS = 21600; // 6h, the CacheService maximum
// The submissions of one video, for the player Info tab. A separate prefix,
// because a "da:" entry holds only the chosen title.
const DEARROW_SUBMISSIONS_CACHE_PREFIX = "das:";
// A cache entry has a size limit, and the Info tab has no use for a long tail
// of titles that nobody votes for. DeArrow sends its best titles first.
const MAX_SUBMISSIONS = 50;

// CacheService.getAll and putAll have a per-call size limit; the feed page is
// small, but history can hold hundreds of videos.
const CACHE_CHUNK = 100;

const MAX_PREFIXES_PER_CALL = 50;

/**
 * The community title of each video that has one, keyed by video id. A video
 * with no title, or whose lookup failed, is absent. Never throws for a failed
 * lookup.
 */
export function getCommunityTitles(videoIds: string[]): {
  [videoId: string]: string;
} {
  // No prototype, so an id such as "constructor" never reads an inherited
  // value.
  const result: Record<string, string> = Object.create(null);
  const ids = Array.from(new Set(videoIds.filter(Boolean)));
  if (ids.length === 0) return result;

  const cache = CacheService.getScriptCache();
  const cached: { [key: string]: string } = {};
  const keys = ids.map((id: string): string => DEARROW_CACHE_PREFIX + id);
  for (let offset = 0; offset < keys.length; offset += CACHE_CHUNK) {
    Object.assign(
      cached,
      cache.getAll(keys.slice(offset, offset + CACHE_CHUNK)),
    );
  }

  // Group the cache misses by hash prefix, so each bucket is asked once. A
  // Map keeps the order of the first-seen id: plain object keys would move
  // all-digit prefixes such as "1234" to the front.
  const missingByPrefix: Map<string, string[]> = new Map();
  for (const id of ids) {
    const hit = parseCachedTitle(cached[DEARROW_CACHE_PREFIX + id]);
    if (hit !== null) {
      if (hit) result[id] = hit;
      continue;
    }
    const prefix = videoIdHashPrefix(id);
    const bucketIds = missingByPrefix.get(prefix) ?? [];
    bucketIds.push(id);
    missingByPrefix.set(prefix, bucketIds);
  }
  // The list waits for this fetch, and UrlFetchApp has no timeout, so a long
  // history must not send hundreds of requests to a volunteer-run server or
  // spend the per-user UrlFetch quota. The top of the list is asked first.
  // The misses past the cap are not cached, so a later load fills them in.
  const prefixes = Array.from(missingByPrefix.keys()).slice(
    0,
    MAX_PREFIXES_PER_CALL,
  );
  if (prefixes.length === 0) return result;

  let responses: GoogleAppsScript.URL_Fetch.HTTPResponse[];
  try {
    responses = UrlFetchApp.fetchAll(
      prefixes.map(
        (prefix: string): GoogleAppsScript.URL_Fetch.URLFetchRequest => ({
          url: DEARROW_API_BASE + prefix,
          muteHttpExceptions: true,
        }),
      ),
    );
  } catch {
    return result; // failed lookup: retry on the next request
  }

  const toCache: { [key: string]: string } = {};
  prefixes.forEach((prefix: string, index: number): void => {
    const titles = readBucket(
      responses[index],
      missingByPrefix.get(prefix) ?? [],
    );
    if (titles === null) return; // failed bucket: not cached
    for (const id of Object.keys(titles)) {
      toCache[DEARROW_CACHE_PREFIX + id] = JSON.stringify(titles[id]);
      if (titles[id]) result[id] = titles[id];
    }
  });

  const entries = Object.keys(toCache);
  try {
    for (let offset = 0; offset < entries.length; offset += CACHE_CHUNK) {
      const chunk: { [key: string]: string } = {};
      for (const key of entries.slice(offset, offset + CACHE_CHUNK))
        chunk[key] = toCache[key];
      cache.putAll(chunk, DEARROW_CACHE_TTL_SECONDS);
    }
  } catch {
    // A cache write failure must not throw away answers already fetched.
  }
  return result;
}

// The title in one cache entry ("" for no title), or null for a miss.
function parseCachedTitle(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

// One entry of the bucket answer: the branding of one video in it.
interface DeArrowBucketEntry {
  titles?: unknown;
}

type DeArrowBucket = { [videoId: string]: DeArrowBucketEntry };

// Picks the asked videos out of one bucket answer. Returns null when the
// lookup failed, which the caller must not cache, and else a title for every
// asked video ("" for none).
function readBucket(
  response: GoogleAppsScript.URL_Fetch.HTTPResponse | undefined,
  videoIds: string[],
): { [videoId: string]: string } | null {
  const bucket = parseBucket(response);
  if (bucket === null) return null;
  const titles: Record<string, string> = Object.create(null);
  for (const id of videoIds)
    titles[id] = chooseCommunityTitle(rawTitlesOf(bucket, id));
  return titles;
}

// The bucket answer keyed by video id, {} for a 404, or null when the lookup
// failed. Never throws.
function parseBucket(
  response: GoogleAppsScript.URL_Fetch.HTTPResponse | undefined,
): DeArrowBucket | null {
  try {
    if (!response) return null;
    const code = response.getResponseCode();
    // Like SponsorBlock, the service sends a 404 to say "nothing here", so
    // this function returns an empty answer that the caller caches. Every
    // other non-200 is a failure.
    if (code === 404) return {};
    if (code !== 200) return null;
    const bucket: unknown = JSON.parse(response.getContentText());
    // A body that parses but is not the bucket object is the same class of
    // failure as one that does not parse at all, so it must not be cached.
    if (!bucket || typeof bucket !== "object" || Array.isArray(bucket))
      return null;
    return bucket as DeArrowBucket;
  } catch {
    return null;
  }
}

// The raw titles list of one video. A video missing from its bucket has no
// titles. The own-property check stops an id such as "constructor" from
// reading an inherited value.
function rawTitlesOf(bucket: DeArrowBucket, videoId: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(bucket, videoId)) return undefined;
  const entry = bucket[videoId];
  return entry ? entry.titles : undefined;
}

/**
 * Every checked title submission of one video, for the player Info tab. It
 * follows the same rules as getCommunityTitles, but asks for one video only:
 * the tab opens for one video at a time. Never throws.
 */
export function getDeArrowSubmissions(
  videoId: string,
): DeArrowSubmissionsResult {
  if (!videoId) return { status: "ok", submissions: [] };

  const key = DEARROW_SUBMISSIONS_CACHE_PREFIX + videoId;
  const cached = parseCachedSubmissions(readCache(key));
  if (cached !== null) return { status: "ok", submissions: cached };

  let response: GoogleAppsScript.URL_Fetch.HTTPResponse;
  try {
    response = UrlFetchApp.fetch(
      DEARROW_API_BASE + videoIdHashPrefix(videoId),
      {
        muteHttpExceptions: true,
      },
    );
  } catch {
    return { status: "failed" }; // failed lookup: retry on the next request
  }
  const bucket = parseBucket(response);
  if (bucket === null) return { status: "failed" };

  const submissions = parseDeArrowSubmissions(
    rawTitlesOf(bucket, videoId),
  ).slice(0, MAX_SUBMISSIONS);
  try {
    // The entry holds JSON, so "no submissions" is "[]" and never an empty
    // value.
    CacheService.getScriptCache().put(
      key,
      JSON.stringify(submissions),
      DEARROW_CACHE_TTL_SECONDS,
    );
  } catch {
    // A cache write failure must not throw away an answer already fetched.
  }
  return { status: "ok", submissions };
}

// One cache entry, or null when it is absent or the cache read failed. A
// failed read is a miss: the lookup can still answer.
function readCache(key: string): string | null {
  try {
    return CacheService.getScriptCache().get(key);
  } catch {
    return null;
  }
}

// The submissions in one cache entry, or null for a miss. Each item is checked
// for its shape but not cleaned again: the title clean-up does not give the
// same result when it runs twice on some titles. One bad item makes the whole
// entry a miss, because a partial list would change the chosen title.
function parseCachedSubmissions(
  raw: string | null,
): DeArrowSubmission[] | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || !value.every(isCachedSubmission)) return null;
    return value as DeArrowSubmission[];
  } catch {
    return null;
  }
}

function isCachedSubmission(item: unknown): boolean {
  if (!item || typeof item !== "object") return false;
  const submission = item as { [field: string]: unknown };
  return (
    typeof submission.title === "string" &&
    (submission.votes === null || typeof submission.votes === "number") &&
    typeof submission.locked === "boolean" &&
    typeof submission.original === "boolean"
  );
}
