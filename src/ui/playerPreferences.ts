// The player's viewing preferences, as src/ui/preferences.ts stores them. Kept in
// their own module because two independent things read them: the player, which
// applies them to the video on show, and the Settings screen, which lists them
// (see src/ui/settingsView.ts). Importing them from playerView.ts would pull the
// whole player into Settings. This mirrors src/ui/feedFilters.ts.

import { getStringPreference, setStringPreference } from "./preferences";
import { parsePlaybackRate } from "../shared/playbackRate";

// Theater mode (desktop): the player breaks out of the centered column and
// fills the window. Persisted so it stays on across videos and visits.
export const THEATER_PREF = "mytube.player.theater";
export const THEATER_DEFAULT = false;

// Sponsor skip: jump past the sponsor and self-promotion parts of a video,
// using the SponsorBlock crowd database (src/server/sponsorBlock.ts). Default
// on: a viewer who does not want it turns it off once.
export const SPONSOR_SKIP_PREF = "mytube.player.sponsorSkip";
export const SPONSOR_SKIP_DEFAULT = true;

// Autoplay: play the next video of the list when one ends. Default off, like
// the per-session checkbox it replaces: an unasked jump to another video is
// worse than a stop.
export const AUTOPLAY_PREF = "mytube.player.autoplay";
export const AUTOPLAY_DEFAULT = false;

// Background play: keep the video playing when the phone locks, by undoing
// the pause that YouTube's embed makes when the page hides (rule in
// src/shared/backgroundPlay.ts). Default on: that pause is never wanted.
export const BACKGROUND_PLAY_PREF = "mytube.player.backgroundPlay";
export const BACKGROUND_PLAY_DEFAULT = true;

// Playback speed: the rate the viewer last chose, remembered per device and
// reapplied to every video. It is a viewing preference, not a per-video fact, so
// it lives here rather than in the server-side progress store. The value is
// stored as a string; parsePlaybackRate (src/shared/playbackRate.ts) owns what
// an unreadable one means.
export const SPEED_PREF = "mytube.player.speed";

export function readStoredPlaybackRate(): number {
  return parsePlaybackRate(getStringPreference(SPEED_PREF, ""));
}

export function storePlaybackRate(rate: number): void {
  setStringPreference(SPEED_PREF, String(rate));
}
