// Keeps app state (current tab, open video) in the browser URL so the browser
// back/forward buttons work and links are shareable.
//
// The UI runs inside Apps Script's sandboxed iframe, so plain history.pushState
// drives only the iframe, not the real address bar. Apps Script exposes
// google.script.history (push/replace/change handler) and google.script.url
// (read the launch URL) for exactly this. Each call is guarded: when the API is
// missing (e.g. an undeployed test run) every function becomes a safe no-op and
// the app still works, just without URL sync.

interface ScriptLocation {
  parameter: { [key: string]: string };
  hash: string;
}
interface HistoryChangeEvent {
  state: unknown;
  location: ScriptLocation;
}
interface ScriptUrl {
  getLocation(callback: (location: ScriptLocation) => void): void;
}
interface ScriptHistory {
  push(
    stateObject: unknown,
    params: { [key: string]: string },
    hash?: string,
  ): void;
  replace(
    stateObject: unknown,
    params: { [key: string]: string },
    hash?: string,
  ): void;
  setChangeHandler(handler: (event: HistoryChangeEvent) => void): void;
}
declare const google: { script: { url?: ScriptUrl; history?: ScriptHistory } };

export type UrlParams = { [key: string]: string };

/** Adds a new browser history entry for the given state and query params. */
export function pushUrlState(state: unknown, params: UrlParams): void {
  try {
    google.script.history?.push(state, params);
  } catch {
    // History API unavailable; navigation still works without URL sync.
  }
}

/** Updates the current history entry in place (no new back/forward step). */
export function replaceUrlState(state: unknown, params: UrlParams): void {
  try {
    google.script.history?.replace(state, params);
  } catch {
    // Ignored; see pushUrlState.
  }
}

/** Calls handler whenever the user navigates with the browser back/forward buttons. */
export function onUrlStateChange(
  handler: (state: unknown, params: UrlParams) => void,
): void {
  try {
    google.script.history?.setChangeHandler((event) =>
      handler(event.state, event.location?.parameter ?? {}),
    );
  } catch {
    // Ignored; back/forward simply will not restore state.
  }
}

/** Reads the query params the app was launched with (for the first render). */
export function readInitialParams(callback: (params: UrlParams) => void): void {
  try {
    if (google.script.url) {
      google.script.url.getLocation((location) =>
        callback(location.parameter ?? {}),
      );
      return;
    }
  } catch {
    // Fall through to the empty-params default.
  }
  callback({});
}
