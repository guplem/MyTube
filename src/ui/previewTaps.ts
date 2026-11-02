// Carries the taps made on a list preview (a saved copy, ADR 0011) over to the
// fresh list. The preview's toggles act at once, and a player opened on the
// preview writes into the preview's Video objects too (flags and the resume
// position). The fresh list holds other objects, and the server can have read
// it before the write landed. So each change on the preview is copied onto the
// fresh objects: first when the fresh list arrives, and again after every later
// write (optimistic() and the player's position save call
// carryLinkedPreviewTaps), on any screen, because the player can stay open on
// preview objects long after the list replaced them.

import type { Video } from "../shared/video";
import { carryPreviewTaps, type PreviewFlags } from "../shared/listSnapshot";
import { persistListSnapshots } from "./listSnapshots";
import { applyFeedNavState } from "./feedNavButton";

interface PreviewLink {
  before: Map<string, PreviewFlags>;
  preview: readonly Video[];
  fresh: readonly Video[];
}

// One link per preview whose fresh list arrived. Only the feed and Watch
// Later show a preview, so a few slots cover every player that can still hold
// preview objects; the cap stops a long session from keeping every old copy.
const MAX_LINKS = 4;
const links: PreviewLink[] = [];

// The Video objects painted from a saved copy. The player asks the server for
// the stored position of these, because the copy's own can be days old.
const previewVideos: WeakSet<Video> = new WeakSet();

export function markPreviewVideos(videos: readonly Video[]): void {
  for (const video of videos) previewVideos.add(video);
}

export function isPreviewVideo(video: Video): boolean {
  return previewVideos.has(video);
}

/** The fresh list arrived: copies the taps made so far, and keeps the pair so
 *  that later writes on the preview objects follow too. `before` holds the
 *  preview's flags as painted; carryPreviewTaps moves it forward. */
export function linkPreviewToFresh(
  before: Map<string, PreviewFlags>,
  preview: readonly Video[],
  fresh: readonly Video[],
): void {
  const index: number = links.findIndex(
    (link: PreviewLink): boolean => link.preview === preview,
  );
  if (index >= 0) links.splice(index, 1);
  links.push({ before, preview, fresh });
  if (links.length > MAX_LINKS) links.shift();
  if (!carryPreviewTaps(before, preview, fresh)) return;
  // The fresh objects are the ones the saved copies and the Feed nav button
  // read (the kept feed page, the Watch Later live source), so both follow.
  persistListSnapshots();
  applyFeedNavState();
}

/** Copies every new change on a linked preview onto its fresh list. The
 *  caller repaints what depends on the fresh objects (optimistic() saves the
 *  copies and recounts the Feed nav button right after). */
export function carryLinkedPreviewTaps(): void {
  for (const link of links)
    carryPreviewTaps(link.before, link.preview, link.fresh);
}
