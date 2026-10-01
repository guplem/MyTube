// The Settings screen: one place that lists every preference the app stores.
// Preferences live in localStorage (src/ui/preferences.ts), and this screen
// reads and writes the very same keys as the controls that already exist (the
// feed toolbar and the player's own buttons), so the two views can never hold
// different values. It owns no preference of its own: even the title switch,
// which has no other control, keeps its key in src/ui/titlePreferences.ts.
//
// The feed filters need more than a write: the feed remembers which page it
// showed, and that page number belongs to the old filters. The caller passes
// onFeedFilterChange for that (feedFilterChanged in src/ui/main.ts), and the
// controls themselves come from src/ui/feedFilterControls.ts, the one copy the
// feed toolbar uses too.

import { getBoolPreference, setBoolPreference } from "./preferences";
import { feedFilterControls } from "./feedFilterControls";
import {
  THEATER_PREF,
  THEATER_DEFAULT,
  SPONSOR_SKIP_PREF,
  SPONSOR_SKIP_DEFAULT,
  BACKGROUND_PLAY_PREF,
  BACKGROUND_PLAY_DEFAULT,
  readStoredPlaybackRate,
  storePlaybackRate,
} from "./playerPreferences";
import {
  COMMUNITY_TITLES_PREF,
  COMMUNITY_TITLES_DEFAULT,
} from "./titlePreferences";
import {
  DEFAULT_PLAYBACK_RATE,
  playbackRateChoices,
  parsePlaybackRate,
} from "../shared/playbackRate";

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
      feedFilterControls(onFeedFilterChange).map(settingsRow),
    ),
  );

  root.appendChild(
    settingsSection("Titles", "Applied to the next list or video you open.", [
      preferenceToggle(
        "Show community titles (DeArrow)",
        COMMUNITY_TITLES_PREF,
        COMMUNITY_TITLES_DEFAULT,
      ),
    ]),
  );

  root.appendChild(
    settingsSection("Player", "Applied to the next video you open.", [
      preferenceToggle("Theater mode (desktop)", THEATER_PREF, THEATER_DEFAULT),
      preferenceToggle(
        "Skip sponsor segments",
        SPONSOR_SKIP_PREF,
        SPONSOR_SKIP_DEFAULT,
      ),
      preferenceToggle(
        "Keep playing when the screen locks",
        BACKGROUND_PLAY_PREF,
        BACKGROUND_PLAY_DEFAULT,
      ),
      playbackRateSetting(),
    ]),
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

// Wraps one control in a Settings row (see .settings-row in src/ui/index.html).
function settingsRow(control: HTMLElement): HTMLElement {
  const row = document.createElement("div");
  row.className = "settings-row";
  row.appendChild(control);
  return row;
}

// A persisted checkbox for one player or title preference. A write is all it
// takes: the player and the cards read the key when they build the next video,
// and no other screen holds state that the change makes wrong. Feed filters do
// need a follow-up, which is why they have their own builder
// (src/ui/feedFilterControls.ts).
function preferenceToggle(
  labelText: string,
  prefKey: string,
  defaultValue: boolean,
): HTMLElement {
  const label = document.createElement("label");
  label.className = "toggle-label";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = getBoolPreference(prefKey, defaultValue);
  checkbox.addEventListener("change", (): void => {
    setBoolPreference(prefKey, checkbox.checked);
  });
  label.append(checkbox, document.createTextNode(labelText));
  return settingsRow(label);
}

// The remembered playback speed. The player writes this key whenever the viewer
// changes speed from YouTube's own controls, so the list must carry the stored
// rate even when it is not one of the standard ones (playbackRateChoices).
function playbackRateSetting(): HTMLElement {
  const label = document.createElement("label");
  label.className = "toggle-label";
  const select = document.createElement("select");
  select.className = "settings-select";
  const current = readStoredPlaybackRate();
  for (const rate of playbackRateChoices(current)) {
    const option = document.createElement("option");
    option.value = String(rate);
    option.textContent = rate === DEFAULT_PLAYBACK_RATE ? "Normal" : `${rate}×`;
    option.selected = rate === current;
    select.appendChild(option);
  }
  // parsePlaybackRate, not a bare parse: it owns what an unreadable value means,
  // so a broken option can never be stored as the string "NaN".
  select.addEventListener("change", (): void => {
    storePlaybackRate(parsePlaybackRate(select.value));
  });
  label.append(document.createTextNode("Playback speed "), select);
  return settingsRow(label);
}
