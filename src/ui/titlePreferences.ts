// The title display preference, as src/ui/preferences.ts stores it. Kept in its
// own module because four independent things read it: the video cards
// (src/ui/videoListView.ts), the playlist title sort (src/ui/main.ts), the
// player (src/ui/playerView.ts), and the Settings screen, which lists it
// (src/ui/settingsView.ts). This mirrors src/ui/playerPreferences.ts. The
// title rules themselves live in src/shared/dearrow.ts.

import { getBoolPreference } from "./preferences";
import { pickDisplayTitle } from "../shared/dearrow";
import type { Video } from "../shared/video";

// Community titles: show the DeArrow title (src/server/dearrow.ts) instead of
// the uploader's title when one exists. Default on, because the app exists to
// cut clickbait: a viewer who wants the uploader's titles turns it off once.
export const COMMUNITY_TITLES_PREF = "mytube.display.communityTitles";
export const COMMUNITY_TITLES_DEFAULT = true;

export function communityTitlesOn(): boolean {
  return getBoolPreference(COMMUNITY_TITLES_PREF, COMMUNITY_TITLES_DEFAULT);
}

/** The title to show for a video. The server always sends both titles, so
 *  this reads the preference at render time and a switch needs no refetch. */
export function displayTitle(video: Video): string {
  return pickDisplayTitle(video, communityTitlesOn());
}
