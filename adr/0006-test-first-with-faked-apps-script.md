# 6. Test-first development on Node/Vitest with faked Apps Script globals

Status: Accepted

## Context

The project had no automated tests. The core concept already works — the
subscriptions feed (RSS → `Video[]` → cache → retry → last-good fallback),
`getFeedPage` filtering/paging, Shorts-by-duration detection, and the
history/dismissed persistence — but every change risked silently regressing it,
and there was no gate stopping a broken change from reaching `main` (which
auto-deploys).

The obstacle to testing is the runtime: server code runs inside Google Apps
Script and calls globals injected by that runtime (`PropertiesService`,
`CacheService`, `UrlFetchApp`, `XmlService`, `YouTube`, `Utilities`). None exist
in Node, and there is no supported way to run Apps Script locally. Two options:

1. Refactor the server to inject the Apps Script services (dependency
   injection), so tests pass in fakes through normal function arguments.
2. Keep the server code as-is and replace the _globals_ with in-memory fakes in
   the test process.

Option 1 means reshaping production code purely for testability and shipping
that indirection to Apps Script. Option 2 tests the real code paths unchanged.

## Decision

Adopt **test-first development (red-green-refactor)** for server logic, run on
Node with **Vitest** (chosen for native TypeScript + ESM, no extra config).

Tests run the **real** `src/server/` code. A test helper
(`tests/helpers/appsScriptMock.ts`) installs in-memory fakes of the Apps Script
globals onto `globalThis` before each test and removes them after, because the
server reaches those services as free globals. `XmlService` is backed by a real
namespace-aware DOM parser (`@xmldom/xmldom`) so RSS parsing is exercised
against real feed XML. No Apps Script shims are added to `src/`.

The browser layer gets **static checks** in `tests/ui/`. They run without a
browser. They read `src/ui/index.html`, `pages/index.html`, `src/server/main.ts`,
and `src/ui/*.ts` as text. They parse the `<style>` block with `postcss`, through
`tests/helpers/stylesheet.ts`. They pin rules for touch, viewport, motion, and
long-text wrapping. A rule that needs a browser or the `google.script.run`
bridge stays untested.

The suite (with typecheck and build) is a **required gate**: it runs in CI on
every PR to `main` and again before deploy, and a PR may not merge until it is
green.

## Consequences

- Almost all server logic is testable without touching production code; new
  data sources/filters/persistence ship with tests in the same PR.
- The fakes approximate Apps Script, not reproduce it. Behaviour that depends on
  real quotas, cache eviction/TTL, or exact `XmlService` quirks is not covered;
  such changes still need a manual check against a real deployment.
- `src/ui/` behaviour is not unit-tested, because it needs a browser and the
  `google.script.run` bridge. Only the static checks in `tests/ui/` cover it.
  Keep UI logic thin and push testable logic into `src/server/` or `src/shared/`.
- The static checks read text, so they prove a rule is written down, not that a
  browser obeys it. A new CSS rule of a pinned kind must satisfy them.
- Adds dev dependencies (`vitest`, `@xmldom/xmldom`, `postcss`) and a `tests/`
  tree. `postcss` parses the stylesheet for the static checks. CI gets a `test`
  job that must be kept green.
