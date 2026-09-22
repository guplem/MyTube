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
//    too, as "": most videos have no title, and they must not be asked twice.
//    A failed bucket is never cached, and it never touches another bucket.
// 3. ONE ROUND TRIP. A list asks for its cache misses at once: one
//    UrlFetchApp.fetchAll with one request per distinct hash prefix, and at
//    most MAX_PREFIXES_PER_CALL prefixes.
//
// Every failure returns no title. A missing title means "show the YouTube
// title", which is the pre-feature behaviour, and a list must never depend on
// a third-party service that is slow or down.
//
// Data is CC BY-NC-SA 4.0; the app footer credits DeArrow.

import { chooseCommunityTitle } from "../shared/dearrow";
import { videoIdHashPrefix } from "./sponsorBlock";

const DEARROW_API_BASE = "https://sponsor.ajay.app/api/branding/";

const DEARROW_CACHE_PREFIX = "da:";
const DEARROW_CACHE_TTL_SECONDS = 21600; // 6h, the CacheService maximum

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
  const result: { [videoId: string]: string } = {};
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
    const hit = cached[DEARROW_CACHE_PREFIX + id];
    if (hit !== undefined) {
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
      toCache[DEARROW_CACHE_PREFIX + id] = titles[id];
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

// One entry of the bucket answer: the branding of one video in it.
interface DeArrowBucketEntry {
  titles?: unknown;
}

// Picks the asked videos out of one bucket answer. Returns null when the
// lookup failed, which the caller must not cache, and else a title for every
// asked video ("" for none).
function readBucket(
  response: GoogleAppsScript.URL_Fetch.HTTPResponse | undefined,
  videoIds: string[],
): { [videoId: string]: string } | null {
  try {
    if (!response) return null;
    const code = response.getResponseCode();
    const titles: { [videoId: string]: string } = {};
    // Like SponsorBlock, the service sends a 404 to say "nothing here", so
    // this function returns an empty answer that the caller caches. Every
    // other non-200 is a failure.
    if (code === 404) {
      for (const id of videoIds) titles[id] = "";
      return titles;
    }
    if (code !== 200) return null;
    const bucket: unknown = JSON.parse(response.getContentText());
    // A body that parses but is not the bucket object is the same class of
    // failure as one that does not parse at all, so it must not be cached.
    if (!bucket || typeof bucket !== "object" || Array.isArray(bucket))
      return null;
    const byId = bucket as { [videoId: string]: DeArrowBucketEntry };
    for (const id of videoIds) {
      // A video missing from its bucket has no community title.
      const entry = Object.prototype.hasOwnProperty.call(byId, id)
        ? byId[id]
        : undefined;
      titles[id] = chooseCommunityTitle(entry ? entry.titles : undefined);
    }
    return titles;
  } catch {
    return null;
  }
}
