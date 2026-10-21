// Remembers UI toggles between visits and across devices. Two copies exist:
//
// - The account copy, on the server (src/server/preferences.ts). It is the
//   truth: every device of the account reads it.
// - The local copy, in localStorage. Every read comes from it, so a read
//   answers at once and needs no server round trip.
//
// doGet embeds the account copy in the page. At load, this module makes the
// local copy match it, before any screen reads a preference. When the account
// has no copy yet, this device uploads its local one (the first device wins).
// Every write goes to both copies. The server write is fire-and-forget, like
// the progress save: the local copy already holds the new value.
//
// Every localStorage access is guarded because storage can be blocked (some
// private-browsing modes), in which case we fall back to the default.

import { importPreferences, setPreference } from "./serverBridge";
import { showToast } from "./toast";
import {
  PREFERENCE_KEY_PREFIX,
  sanitizePreferences,
  type Preferences,
} from "../shared/preferences";

interface AccountPreferencesHost {
  // Undefined when the page carries no embed (a preview of the plain HTML).
  MYTUBE_ACCOUNT_PREFERENCES?: Preferences | null;
}

syncFromAccount();

export function getBoolPreference(key: string, fallback: boolean): boolean {
  try {
    const stored = window.localStorage.getItem(key);
    return stored === null ? fallback : stored === "true";
  } catch {
    return fallback;
  }
}

export function setBoolPreference(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Storage unavailable; the toggle still works for this session.
  }
  saveToAccount(key, String(value));
}

export function getStringPreference(key: string, fallback: string): string {
  try {
    const stored = window.localStorage.getItem(key);
    return stored === null ? fallback : stored;
  } catch {
    return fallback;
  }
}

/** Stores a string preference; an empty value clears it. */
export function setStringPreference(key: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Storage unavailable; ignored.
  }
  saveToAccount(key, value || null);
}

function saveToAccount(key: string, value: string | null): void {
  setPreference(key, value).catch((): void => {
    showToast("Couldn't save this setting to your account.");
  });
}

function syncFromAccount(): void {
  const account: Preferences | null | undefined = (
    window as unknown as AccountPreferencesHost
  ).MYTUBE_ACCOUNT_PREFERENCES;
  if (account === undefined) return;
  if (account === null) {
    importPreferences(localPreferences()).catch((): void => {
      // The next page load tries again: the account still has no copy.
    });
    return;
  }
  try {
    for (const key of Object.keys(localPreferences())) {
      if (!(key in account)) window.localStorage.removeItem(key);
    }
    for (const [key, value] of Object.entries(account)) {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Storage unavailable; the reads fall back to the defaults.
  }
}

function localPreferences(): Preferences {
  const local: Record<string, string> = {};
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key: string | null = window.localStorage.key(i);
      if (key === null || !key.startsWith(PREFERENCE_KEY_PREFIX)) continue;
      const value: string | null = window.localStorage.getItem(key);
      if (value !== null) local[key] = value;
    }
  } catch {
    // Storage unavailable; nothing to upload.
  }
  return sanitizePreferences(local);
}
