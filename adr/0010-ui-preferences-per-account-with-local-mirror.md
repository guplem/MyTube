# 10. Store UI preferences per Google account, mirrored in localStorage

Status: Accepted

## Context

The app first kept UI preferences (feed filters, player switches, title display) only in `localStorage`. Chrome splits `localStorage` by the top-level site. The GitHub Pages wrapper in `pages/` and the plain `script.google.com` URL are different top-level sites, so the same user saw different filters in each. A second device also started with no settings.

Reads must stay synchronous: screens read a preference while they draw, and a server round trip per read is too slow.

## Decision

The account holds the truth. `src/server/preferences.ts` keeps the whole set as ONE JSON user property named `preferences` (same per-user store as ADR 0005). A missing property means "never stored". The value `{}` means "stored, and empty". The two cases differ on purpose.

The browser keeps a mirror:

- `doGet` embeds the stored set in the page. `preferencesScriptLiteral` (`src/shared/preferences.ts`) escapes `<` so a value cannot end the script early.
- `src/ui/preferences.ts` copies the embedded set into `localStorage` when the module loads, before any screen reads. All reads then come from `localStorage`.
- Every write goes to `localStorage` and to the server (`setPreference`). The server call is fire-and-forget and shows a toast on failure.
- When the account has no stored set, the browser uploads its non-empty local set with `importPreferences`. The first device wins. An empty import stores nothing, so a fresh browser cannot wipe the set of other devices.

The server and the browser share one validation policy in `src/shared/preferences.ts`: key prefix, key count cap, and key and value length caps. Server writes run under the user lock.

**Rejected alternative:** `localStorage` only. It splits by top-level site, so the wrapper and the plain URL disagree, and it gives no cross-device sync.

**Rejected alternative:** read each preference from the server on demand. It makes every read asynchronous and adds a round trip to every screen.

## Consequences

- The wrapper, the plain URL, and every device of one account show the same preferences.
- The page loads with the account set already in place, so no extra request delays the first feed request.
- A failed server write leaves the local value in place, so the device can differ from the account until the next write or page load. The next page load then replaces the local copy with the account copy.
- Every new preference key must start with the `mytube.` prefix, or the policy refuses it.
