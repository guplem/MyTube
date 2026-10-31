// Builds the "new uploads" feed from each subscribed channel's RSS feed.
//
// RSS is free (no API quota) and returns each channel's latest ~15 videos, which
// is exactly what a "what's new" feed wants. To keep this fast, each channel's
// parsed videos are cached (CacheService); a load only fetches the channels
// whose cache has expired, then fetches those in parallel with
// UrlFetchApp.fetchAll. Results merge newest first. See PLAN.md section 5.

import type { Video } from "../shared/video";
import type { UploadsFeed } from "../shared/feed";
import { getSubscriptionChannels, type SubscriptionChannel } from "./youtube";
import type { Stopwatch } from "./timing";

const RSS_FEED_BASE = "https://www.youtube.com/feeds/videos.xml?channel_id=";
// Freshness window: within this, a channel's cached videos are reused without
// refetching. The "last good" copy lives much longer (below) as a failure fallback.
const CHANNEL_VIDEOS_TTL_SECONDS = 1800; // re-fetch a channel's RSS at most every 30 min
const LAST_GOOD_TTL_SECONDS = 21600; // 6h (CacheService maximum); fallback when a fetch fails
// YouTube rate-limits bulk RSS fetches from Apps Script's shared IPs, so a
// subset of channels often returns non-200 on a cold load. Retry the failures a
// couple of times with a short backoff before giving up on them.
const MAX_FETCH_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [600, 1500];
// CacheService getAll/putAll degrade with very large batches; chunk like the
// duration cache in youtube.ts does.
const CACHE_BATCH_SIZE = 100;

const ATOM_NS = "http://www.w3.org/2005/Atom";
const YT_NS = "http://www.youtube.com/xml/schemas/2015";
const MEDIA_NS = "http://search.yahoo.com/mrss/";

/**
 * Recent uploads across all subscriptions, newest first, plus how many channels
 * could not be fetched fresh this load. Pass true to bypass the freshness cache.
 *
 * A channel whose RSS fetch fails (after retries) is served from its longer-lived
 * "last good" cache when available, so a transient YouTube throttle does not make
 * the channel silently vanish from the feed. failedChannels counts every channel
 * we could not refresh this load (whether or not a cached copy filled the gap), so
 * the UI can tell the user the list may be incomplete.
 */
export function getUploadsFeed(
  forceRefresh: boolean,
  stopwatch?: Stopwatch,
): UploadsFeed {
  const channels = getSubscriptionChannels(forceRefresh);
  stopwatch?.lap("channels", channels.length + " subscriptions");
  if (channels.length === 0)
    return { videos: [], failedChannels: 0, totalChannels: 0 };

  const cache = CacheService.getScriptCache();
  const cached: { [key: string]: string } = forceRefresh
    ? {}
    : getAllChunked(
        cache,
        channels.map((channel) => freshKey(channel.channelId)),
      );

  const videos: Video[] = [];
  let toFetch: SubscriptionChannel[] = [];
  for (const channel of channels) {
    const hit = cached[freshKey(channel.channelId)];
    if (hit) {
      try {
        videos.push(...(JSON.parse(hit) as Video[]));
        continue;
      } catch {
        // Cache entry was corrupt; refetch this channel.
      }
    }
    toFetch.push(channel);
  }
  stopwatch?.lap("rss cache", toFetch.length + " expired");

  const fetchStats: FetchStats = { parseMs: 0, attempts: 0 };
  const expired: number = toFetch.length;
  for (
    let attempt = 0;
    toFetch.length > 0 && attempt < MAX_FETCH_ATTEMPTS;
    attempt += 1
  ) {
    if (attempt > 0) Utilities.sleep(RETRY_BACKOFF_MS[attempt - 1] ?? 1500);
    toFetch = fetchChannels(toFetch, cache, videos, fetchStats);
  }
  if (expired > 0)
    stopwatch?.lap(
      "rss fetch",
      expired +
        " channels, " +
        fetchStats.attempts +
        " attempts, XML parse " +
        fetchStats.parseMs +
        "ms",
    );

  // Anything still unfetched after retries: fall back to the last good copy so a
  // transient failure shows stale videos rather than dropping the channel.
  const failed = toFetch;
  if (failed.length > 0) {
    const lastGood = getAllChunked(
      cache,
      failed.map((channel) => lastGoodKey(channel.channelId)),
    );
    for (const channel of failed) {
      const hit = lastGood[lastGoodKey(channel.channelId)];
      if (!hit) continue;
      try {
        videos.push(...(JSON.parse(hit) as Video[]));
      } catch {
        // Corrupt fallback; leave this channel out of the list.
      }
    }
  }

  videos.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return {
    videos,
    failedChannels: failed.length,
    totalChannels: channels.length,
  };
}

// What fetchChannels spent, summed over the retry attempts, for the timing line.
interface FetchStats {
  parseMs: number;
  attempts: number;
}

// Fetches the given channels' RSS in parallel, pushing parsed videos into
// `videos` and caching each success (both the freshness copy and the long-lived
// last-good copy). Returns the channels that failed (non-200 or unparseable) so
// the caller can retry just those.
function fetchChannels(
  channels: SubscriptionChannel[],
  cache: GoogleAppsScript.Cache.Cache,
  videos: Video[],
  stats: FetchStats,
): SubscriptionChannel[] {
  stats.attempts += 1;
  const requests = channels.map((channel) => ({
    url: RSS_FEED_BASE + channel.channelId,
    muteHttpExceptions: true,
  }));
  const responses = UrlFetchApp.fetchAll(requests);

  const fresh: { [key: string]: string } = {};
  const lastGood: { [key: string]: string } = {};
  const failed: SubscriptionChannel[] = [];
  responses.forEach((response, index): void => {
    const channel = channels[index];
    if (response.getResponseCode() !== 200) {
      failed.push(channel);
      return;
    }
    try {
      const parseStartedAt: number = Date.now();
      const channelVideos = parseChannelFeed(response.getContentText());
      stats.parseMs += Date.now() - parseStartedAt;
      const serialized = JSON.stringify(channelVideos);
      videos.push(...channelVideos);
      fresh[freshKey(channel.channelId)] = serialized;
      lastGood[lastGoodKey(channel.channelId)] = serialized;
    } catch {
      // Skip one malformed feed rather than failing the whole list.
      failed.push(channel);
    }
  });
  if (Object.keys(fresh).length > 0) {
    putAllChunked(cache, fresh, CHANNEL_VIDEOS_TTL_SECONDS);
    putAllChunked(cache, lastGood, LAST_GOOD_TTL_SECONDS);
  }
  return failed;
}

function getAllChunked(
  cache: GoogleAppsScript.Cache.Cache,
  keys: string[],
): { [key: string]: string } {
  const result: { [key: string]: string } = {};
  for (let offset = 0; offset < keys.length; offset += CACHE_BATCH_SIZE) {
    Object.assign(
      result,
      cache.getAll(keys.slice(offset, offset + CACHE_BATCH_SIZE)),
    );
  }
  return result;
}

function putAllChunked(
  cache: GoogleAppsScript.Cache.Cache,
  values: { [key: string]: string },
  ttlSeconds: number,
): void {
  const keys = Object.keys(values);
  for (let offset = 0; offset < keys.length; offset += CACHE_BATCH_SIZE) {
    const chunk: { [key: string]: string } = {};
    for (const key of keys.slice(offset, offset + CACHE_BATCH_SIZE))
      chunk[key] = values[key];
    cache.putAll(chunk, ttlSeconds);
  }
}

function freshKey(channelId: string): string {
  return `feed:${channelId}`;
}

function lastGoodKey(channelId: string): string {
  return `feedlast:${channelId}`;
}

function parseChannelFeed(xml: string): Video[] {
  const atom = XmlService.getNamespace(ATOM_NS);
  const yt = XmlService.getNamespace("yt", YT_NS);
  const media = XmlService.getNamespace("media", MEDIA_NS);

  const root = XmlService.parse(xml).getRootElement();
  const entries = root.getChildren("entry", atom);

  const videos: Video[] = [];
  for (const entry of entries) {
    const videoId = childText(entry, "videoId", yt);
    const title = childText(entry, "title", atom);
    if (!videoId || !title) continue;

    const author = entry.getChild("author", atom);
    const group = entry.getChild("group", media);
    const thumbnail = group ? group.getChild("thumbnail", media) : null;
    const thumbnailAttr = thumbnail ? thumbnail.getAttribute("url") : null;

    videos.push({
      videoId,
      title,
      channelId: childText(entry, "channelId", yt),
      channelTitle: author ? childText(author, "name", atom) : "",
      thumbnailUrl: thumbnailAttr ? thumbnailAttr.getValue() : "",
      publishedAt: childText(entry, "published", atom),
      seen: false,
    });
  }
  return videos;
}

function childText(
  element: GoogleAppsScript.XML_Service.Element,
  name: string,
  namespace: GoogleAppsScript.XML_Service.Namespace,
): string {
  const child = element.getChild(name, namespace);
  return child ? child.getText() : "";
}
