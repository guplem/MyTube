// Remembers UI toggles between visits. Apps Script serves the UI inside an
// iframe where window.localStorage persists per origin, so a server round-trip
// is not needed. Every access is guarded because storage can be blocked (some
// private-browsing modes), in which case we fall back to the default.

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
}
