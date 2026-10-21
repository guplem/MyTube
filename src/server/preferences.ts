// Per-account UI preferences (the feed filters, the player switches, the title
// display), stored in the script's own PropertiesService like the watch history
// (ADR 0005). Every device of the account then reads the same set. Before this,
// each browser kept its own copy in localStorage, and Chrome splits that
// storage by the top page, so the GitHub Pages wrapper and the plain Apps
// Script URL started with different filters.
//
// The whole set is one JSON property: it is a few hundred bytes, far under the
// 9KB-per-value cap. A missing property means "this account never stored a
// set", which is different from "{}" (a stored set with nothing in it). The
// browser uploads its local copy only in the first case (importPreferences).

import {
  MAX_PREFERENCE_KEYS,
  isValidPreference,
  sanitizePreferences,
  type Preferences,
} from "../shared/preferences";

const PROPERTY_KEY = "preferences";

/** The stored set, or null when the account has never stored one. */
export function getPreferences(): Preferences | null {
  const raw: string | null =
    PropertiesService.getUserProperties().getProperty(PROPERTY_KEY);
  if (raw === null) return null;
  try {
    return sanitizePreferences(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Stores one preference; a null value removes it. */
export function setPreference(key: string, value: string | null): void {
  if (!isValidPreference(key, value ?? "")) {
    throw new Error("Invalid preference: " + key);
  }
  withUserLock(() => {
    const prefs: Preferences = getPreferences() ?? {};
    if (value === null) {
      delete prefs[key];
    } else {
      if (!(key in prefs) && Object.keys(prefs).length >= MAX_PREFERENCE_KEYS) {
        throw new Error("Too many preferences");
      }
      prefs[key] = value;
    }
    write(prefs);
  });
}

/**
 * Stores a device's local set, but only on an account with no stored set yet.
 * The check runs under the lock, so when two devices race, the first one wins
 * and the second one adopts its set on the next page load. An empty set stays
 * unstored: a fresh browser would otherwise store "{}" and wipe the filters of
 * every device that opens later.
 */
export function importPreferences(prefs: unknown): void {
  const imported: Preferences = sanitizePreferences(prefs);
  if (Object.keys(imported).length === 0) return;
  withUserLock(() => {
    if (getPreferences() !== null) return;
    write(imported);
  });
}

function write(prefs: Preferences): void {
  PropertiesService.getUserProperties().setProperty(
    PROPERTY_KEY,
    JSON.stringify(prefs),
  );
}

// Serializes the read-modify-write against concurrent executions of this user
// (two quick toggles fire two server calls in parallel). Reads stay lock-free.
function withUserLock<T>(action: () => T): T {
  const lock = LockService.getUserLock();
  lock.waitLock(10000);
  try {
    return action();
  } finally {
    lock.releaseLock();
  }
}
