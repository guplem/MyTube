// Builds the "new uploads" feed from each subscribed channel's RSS feed.
//
// RSS is free (no API quota) and returns each channel's latest ~15 videos, which
// is exactly what a "what's new" feed wants. We fetch all channels in parallel
// with UrlFetchApp.fetchAll and merge the results, newest first. See PLAN.md
// section 5.

import type { Video } from "../shared/video";
import { getSubscriptionChannels } from "./youtube";

const RSS_FEED_BASE = "https://www.youtube.com/feeds/videos.xml?channel_id=";

const ATOM_NS = "http://www.w3.org/2005/Atom";
const YT_NS = "http://www.youtube.com/xml/schemas/2015";
const MEDIA_NS = "http://search.yahoo.com/mrss/";

/** Recent uploads across all subscriptions, newest first. Pass true to refetch channels. */
export function getUploadsFeed(forceRefresh: boolean): Video[] {
  const channels = getSubscriptionChannels(forceRefresh);
  if (channels.length === 0) return [];

  const requests = channels.map((channel) => ({
    url: RSS_FEED_BASE + channel.channelId,
    muteHttpExceptions: true,
  }));
  const responses = UrlFetchApp.fetchAll(requests);

  const videos: Video[] = [];
  for (const response of responses) {
    if (response.getResponseCode() !== 200) continue;
    try {
      videos.push(...parseChannelFeed(response.getContentText()));
    } catch (error) {
      // Skip one malformed feed rather than failing the whole list.
    }
  }
  videos.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return videos;
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
