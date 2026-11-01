// The feed's filter toggles, as src/ui/preferences.ts stores them. Kept in their
// own module because two independent things read them: the feed screen, which
// turns them into a getFeedPage request, and the Feed nav button, which needs
// the flag filters to tell whether a video the user just dealt with still counts
// (see feedNavButton.ts). Importing them from main.ts would be a cycle.

import { getBoolPreference } from "./preferences";
import type { FeedFlagFilters } from "../shared/feedInclusion";

export const HIDE_SHORTS_PREF = "mytube.hideShorts";
export const HIDE_UPCOMING_PREF = "mytube.hideUpcoming";
export const HIDE_VIEWED_PREF = "mytube.hideViewed";
export const HIDE_DISMISSED_PREF = "mytube.hideDismissed";
export const HIDE_SAVED_PREF = "mytube.hideSaved";
export const BEFORE_DATE_PREF = "mytube.beforeDate";

// Defaults, in one place so the feed's request and the nav button's recount can
// never read the same toggle differently. "Hide watched" is the odd one out: a
// watched video stays visible unless the user asks otherwise.
export const HIDE_SHORTS_DEFAULT = true;
// On by default: an announced video cannot play yet, so it only waits in the
// way. It shares the length lookup with "Hide Shorts", so it costs no request.
export const HIDE_UPCOMING_DEFAULT = true;
export const HIDE_VIEWED_DEFAULT = false;
export const HIDE_DISMISSED_DEFAULT = true;
export const HIDE_SAVED_DEFAULT = true;

/** The three filters that read flags a card action can change. */
export function feedFlagFilters(): FeedFlagFilters {
  return {
    hideViewed: getBoolPreference(HIDE_VIEWED_PREF, HIDE_VIEWED_DEFAULT),
    hideDismissed: getBoolPreference(
      HIDE_DISMISSED_PREF,
      HIDE_DISMISSED_DEFAULT,
    ),
    hideSaved: getBoolPreference(HIDE_SAVED_PREF, HIDE_SAVED_DEFAULT),
  };
}
