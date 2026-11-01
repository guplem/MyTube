// The feed's filter controls as DOM elements, built in one place for both
// screens that show them: the feed toolbar (src/ui/main.ts) and the Settings
// screen (src/ui/settingsView.ts). Two copies of the same control drift apart in
// label, default and update path, and a filter that forgets its update path
// leaves the kept feed page (ADR 0008) and the Feed nav button stale.
//
// They do not live in src/ui/feedFilters.ts: that module holds the preference
// keys alone and touches no DOM, because src/ui/feedNavButton.ts imports it.
//
// afterChange is a required parameter, so a new feed filter cannot compile
// without saying what happens after the write. Player preferences have no such
// follow-up, so their checkbox is built by settingsView.ts instead.

import {
  getBoolPreference,
  setBoolPreference,
  getStringPreference,
  setStringPreference,
} from "./preferences";
import { defaultFeedBeforeDate } from "../shared/feed";
import {
  HIDE_SHORTS_PREF,
  HIDE_UPCOMING_PREF,
  HIDE_VIEWED_PREF,
  HIDE_DISMISSED_PREF,
  HIDE_SAVED_PREF,
  BEFORE_DATE_PREF,
  HIDE_SHORTS_DEFAULT,
  HIDE_UPCOMING_DEFAULT,
  HIDE_VIEWED_DEFAULT,
  HIDE_DISMISSED_DEFAULT,
  HIDE_SAVED_DEFAULT,
} from "./feedFilters";

/** Every feed filter control, in the order both screens show them. afterChange
 *  runs after each write (feedFilterChanged in src/ui/main.ts). The caller
 *  places the elements: the toolbar puts them in one line, Settings puts each
 *  one on its own row. */
export function feedFilterControls(afterChange: () => void): HTMLElement[] {
  return [
    filterToggle(
      "Hide Shorts",
      HIDE_SHORTS_PREF,
      HIDE_SHORTS_DEFAULT,
      afterChange,
    ),
    // Premieres and live streams that are announced but not out yet.
    filterToggle(
      "Hide upcoming",
      HIDE_UPCOMING_PREF,
      HIDE_UPCOMING_DEFAULT,
      afterChange,
    ),
    // "watched" is the UI word for the seen flag (matching the History tab);
    // the preference key keeps its old name so stored settings survive.
    filterToggle(
      "Hide watched",
      HIDE_VIEWED_PREF,
      HIDE_VIEWED_DEFAULT,
      afterChange,
    ),
    filterToggle(
      "Hide dismissed",
      HIDE_DISMISSED_PREF,
      HIDE_DISMISSED_DEFAULT,
      afterChange,
    ),
    // On by default: a saved video is already dealt with, so keeping it out
    // makes the feed an inbox of videos still waiting for a decision.
    filterToggle(
      "Hide saved",
      HIDE_SAVED_PREF,
      HIDE_SAVED_DEFAULT,
      afterChange,
    ),
    beforeDateControl(afterChange),
  ];
}

// A persisted checkbox for one feed filter. Saves the preference, then runs
// afterChange so the feed picks the new state up.
function filterToggle(
  labelText: string,
  prefKey: string,
  defaultValue: boolean,
  afterChange: () => void,
): HTMLElement {
  const label = document.createElement("label");
  label.className = "toggle-label";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = getBoolPreference(prefKey, defaultValue);
  checkbox.addEventListener("change", (): void => {
    setBoolPreference(prefKey, checkbox.checked);
    afterChange();
  });
  label.append(checkbox, document.createTextNode(labelText));
  return label;
}

// The feed's date filter: hide videos published before the chosen date. The
// feed is always bounded — with nothing stored (first login, or after clearing
// the field) it falls back to defaultFeedBeforeDate. The user can pick an older
// date to widen it, but there is no "show all" state, which keeps the
// Shorts-duration lookups small. It marks nothing as seen, so playlists and
// Watch Later are unaffected.
function beforeDateControl(afterChange: () => void): HTMLElement {
  const label = document.createElement("label");
  label.className = "toggle-label";
  const input = document.createElement("input");
  input.type = "date";
  input.className = "feed-date";
  input.value = getStringPreference(
    BEFORE_DATE_PREF,
    defaultFeedBeforeDate(new Date()),
  );
  input.addEventListener("change", (): void => {
    setStringPreference(BEFORE_DATE_PREF, input.value);
    afterChange();
  });
  label.append(document.createTextNode("Hide older than "), input);
  return label;
}
