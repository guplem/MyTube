// The Settings screen: one place that lists every preference the app stores.
// Preferences live in localStorage (src/ui/preferences.ts), and this screen
// reads and writes the very same keys as the controls that already exist (the
// feed toolbar and the player's own buttons), so the two views can never hold
// different values. It owns no preference of its own.
//
// The feed filters need more than a write: the feed remembers which page it
// showed, and that page number belongs to the old filters. The caller passes
// onFeedFilterChange for that (feedFilterChanged in src/ui/main.ts).

import {
  getBoolPreference,
  setBoolPreference,
  getStringPreference,
  setStringPreference,
} from "./preferences";
import { defaultFeedBeforeDate } from "../shared/feed";
import {
  HIDE_SHORTS_PREF,
  HIDE_VIEWED_PREF,
  HIDE_DISMISSED_PREF,
  HIDE_SAVED_PREF,
  BEFORE_DATE_PREF,
  HIDE_SHORTS_DEFAULT,
  HIDE_VIEWED_DEFAULT,
  HIDE_DISMISSED_DEFAULT,
  HIDE_SAVED_DEFAULT,
} from "./feedFilters";
import {
  THEATER_PREF,
  THEATER_DEFAULT,
  SPONSOR_SKIP_PREF,
  SPONSOR_SKIP_DEFAULT,
  readStoredPlaybackRate,
  storePlaybackRate,
} from "./playerPreferences";
import { playbackRateChoices } from "../shared/playbackRate";

/** Builds the Settings screen. onFeedFilterChange runs after a feed filter
 *  changes, so the feed picks the change up. */
export function SettingsView(onFeedFilterChange: () => void): HTMLElement {
  const root = document.createElement("div");
  root.className = "settings";

  const title = document.createElement("h2");
  title.className = "settings-title";
  title.textContent = "Settings";
  root.appendChild(title);

  root.appendChild(
    settingsSection(
      "Feed",
      "The same filters as the feed toolbar. A change here shows there too.",
      [
        booleanSetting(
          "Hide Shorts",
          HIDE_SHORTS_PREF,
          HIDE_SHORTS_DEFAULT,
          onFeedFilterChange,
        ),
        // "watched" is the UI word for the seen flag (matching the History
        // tab); the preference key keeps its old name so stored settings
        // survive.
        booleanSetting(
          "Hide watched",
          HIDE_VIEWED_PREF,
          HIDE_VIEWED_DEFAULT,
          onFeedFilterChange,
        ),
        booleanSetting(
          "Hide dismissed",
          HIDE_DISMISSED_PREF,
          HIDE_DISMISSED_DEFAULT,
          onFeedFilterChange,
        ),
        booleanSetting(
          "Hide saved",
          HIDE_SAVED_PREF,
          HIDE_SAVED_DEFAULT,
          onFeedFilterChange,
        ),
        beforeDateSetting(onFeedFilterChange),
      ],
    ),
  );

  root.appendChild(
    settingsSection(
      "Player",
      "Applied to the next video you open, and to the one playing now where the player can.",
      [
        booleanSetting("Theater mode (desktop)", THEATER_PREF, THEATER_DEFAULT),
        booleanSetting(
          "Skip sponsor segments",
          SPONSOR_SKIP_PREF,
          SPONSOR_SKIP_DEFAULT,
        ),
        playbackRateSetting(),
      ],
    ),
  );

  return root;
}

// A titled group of settings, with one line saying what the group covers.
function settingsSection(
  heading: string,
  description: string,
  rows: HTMLElement[],
): HTMLElement {
  const section = document.createElement("section");
  section.className = "settings-section";

  const title = document.createElement("h3");
  title.className = "settings-heading";
  title.textContent = heading;

  const note = document.createElement("p");
  note.className = "settings-note";
  note.textContent = description;

  section.append(title, note, ...rows);
  return section;
}

// A persisted checkbox. Saves on change; afterChange runs only for the settings
// that another screen must react to.
function booleanSetting(
  labelText: string,
  prefKey: string,
  defaultValue: boolean,
  afterChange?: () => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "settings-row";
  const label = document.createElement("label");
  label.className = "feed-toggle";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = getBoolPreference(prefKey, defaultValue);
  checkbox.addEventListener("change", (): void => {
    setBoolPreference(prefKey, checkbox.checked);
    afterChange?.();
  });
  label.append(checkbox, document.createTextNode(labelText));
  row.appendChild(label);
  return row;
}

// The feed's date filter: hide videos published before the chosen date. The
// feed is always bounded, so an empty field falls back to defaultFeedBeforeDate
// instead of showing everything (see beforeDateControl in src/ui/main.ts).
function beforeDateSetting(afterChange: () => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "settings-row";
  const label = document.createElement("label");
  label.className = "feed-toggle";
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
  row.appendChild(label);
  return row;
}

// The remembered playback speed. The player writes this key whenever the viewer
// changes speed from YouTube's own controls, so the list must carry the stored
// rate even when it is not one of the standard ones (playbackRateChoices).
function playbackRateSetting(): HTMLElement {
  const row = document.createElement("div");
  row.className = "settings-row";
  const label = document.createElement("label");
  label.className = "feed-toggle";
  const select = document.createElement("select");
  select.className = "sort-select";
  const current = readStoredPlaybackRate();
  for (const rate of playbackRateChoices(current)) {
    const option = document.createElement("option");
    option.value = String(rate);
    option.textContent = rate === 1 ? "Normal" : `${rate}×`;
    option.selected = rate === current;
    select.appendChild(option);
  }
  select.addEventListener("change", (): void => {
    storePlaybackRate(Number.parseFloat(select.value));
  });
  label.append(document.createTextNode("Playback speed "), select);
  row.appendChild(label);
  return row;
}
