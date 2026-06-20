// Reads the user's subscriptions through the YouTube advanced service.
//
// We call the API only to learn which channels the user is subscribed to, and we
// cache that list per user. The actual videos come from each channel's RSS feed
// (see feed.ts), which costs no API quota. See PLAN.md section 5.

export interface SubscriptionChannel {
  channelId: string;
  title: string;
}

const CACHE_KEY = "subscriptionChannels";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // refresh the channel list at most daily

interface CachedChannels {
  fetchedAt: number;
  channels: SubscriptionChannel[];
}

/** Returns the user's subscription channels, cached for a day. Pass true to refetch. */
export function getSubscriptionChannels(forceRefresh: boolean): SubscriptionChannel[] {
  const properties = PropertiesService.getUserProperties();
  if (!forceRefresh) {
    const cached = properties.getProperty(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as CachedChannels;
      if (Date.now() - parsed.fetchedAt < CACHE_TTL_MS) return parsed.channels;
    }
  }
  const channels = fetchAllSubscriptionChannels();
  const toStore: CachedChannels = { fetchedAt: Date.now(), channels };
  properties.setProperty(CACHE_KEY, JSON.stringify(toStore));
  return channels;
}

function fetchAllSubscriptionChannels(): SubscriptionChannel[] {
  const channels: SubscriptionChannel[] = [];
  let pageToken: string | undefined = undefined;
  do {
    const response: GoogleAppsScript.YouTube.Schema.SubscriptionListResponse =
      YouTube.Subscriptions!.list("snippet", {
        mine: true,
        maxResults: 50,
        order: "alphabetical",
        pageToken,
      });
    for (const item of response.items ?? []) {
      const channelId = item.snippet?.resourceId?.channelId;
      if (channelId) {
        channels.push({ channelId, title: item.snippet?.title ?? "" });
      }
    }
    pageToken = response.nextPageToken ?? undefined;
  } while (pageToken);
  return channels;
}
