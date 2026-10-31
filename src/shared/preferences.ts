// The policy for the UI preferences that the account store keeps (see
// src/server/preferences.ts). The server and the browser share it, so the
// browser never sends a set that the server would refuse.
//
// The caps bound the one property that holds the set. The app has about ten
// preferences of a few bytes each, so the caps never bite in normal use. They
// stop a bad client from filling the 500KB store that the history shares.

export const PREFERENCE_KEY_PREFIX = "mytube.";
export const MAX_PREFERENCE_KEYS = 50;
export const MAX_PREFERENCE_KEY_LENGTH = 64;
export const MAX_PREFERENCE_VALUE_LENGTH = 100;

export type Preferences = Record<string, string>;

export function isValidPreference(key: string, value: string): boolean {
  return (
    key.startsWith(PREFERENCE_KEY_PREFIX) &&
    key.length <= MAX_PREFERENCE_KEY_LENGTH &&
    value.length <= MAX_PREFERENCE_VALUE_LENGTH
  );
}

/** Keeps the valid string entries of untrusted input, up to the key cap. */
export function sanitizePreferences(input: unknown): Preferences {
  const result: Preferences = {};
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return result;
  }
  for (const [key, value] of Object.entries(input)) {
    if (Object.keys(result).length >= MAX_PREFERENCE_KEYS) break;
    if (typeof value === "string" && isValidPreference(key, value)) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * The stored set as a JavaScript literal for a <script> in the served page.
 * JSON alone is not safe there: a value that holds "</script>" would end the
 * script early. Escape "<" and the two line separators that JSON allows but
 * older script parsers reject.
 */
export function preferencesScriptLiteral(prefs: Preferences | null): string {
  return scriptLiteral(prefs);
}

/** Any JSON value as a literal for a <script> in the served page, escaped
 *  the same way as the preferences above. */
export function scriptLiteral(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
