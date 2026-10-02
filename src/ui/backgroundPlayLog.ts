// TEMPORARY diagnostic for background play (see src/shared/backgroundPlay.ts).
// The restart after a phone lock does not work on Android Chrome, and the
// cause is not known. This log records each step with its time, so one test
// on the phone shows where the chain breaks. Settings shows the log. Remove
// this module and its callers once the cause is known.

const LOG_KEY = "mytube.debug.backgroundPlayLog";
const MAX_ENTRIES = 60;

function readEntries(): string[] {
  try {
    const stored: string | null = window.localStorage.getItem(LOG_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function logBackgroundPlay(message: string): void {
  const time: string = new Date().toISOString().slice(11, 23);
  const entry: string = time + " [" + document.visibilityState + "] " + message;
  try {
    const entries: string[] = readEntries();
    entries.push(entry);
    window.localStorage.setItem(
      LOG_KEY,
      JSON.stringify(entries.slice(-MAX_ENTRIES)),
    );
  } catch {
    // Storage unavailable; the log is best-effort.
  }
}

export function readBackgroundPlayLog(): string[] {
  return readEntries();
}

export function clearBackgroundPlayLog(): void {
  try {
    window.localStorage.removeItem(LOG_KEY);
  } catch {
    // Storage unavailable; nothing to clear.
  }
}
