# 3. Expose server functions to google.script.run via generated top-level wrappers

Status: Accepted

## Context

We bundle the TypeScript server with esbuild, which wraps the output in an IIFE
and hides function declarations. Apps Script builds the `google.script.run`
client proxy by statically scanning the pushed file for top-level function
declarations, so bundled functions were invisible and calls failed with "is not
a function."

## Decision

Mark every externally reachable function with `export` in `src/server/main.ts`.
`build.mjs` reads those export names and appends real top-level wrapper functions
to `dist/Code.js` that forward into the bundle (the `__server` global).

## Consequences

- `google.script.run` and `doGet` resolve correctly; adding a server call is just
  adding an `export function`.
- The build gains a small generation step; the contract is "export = callable."
- Assigning to `globalThis` at runtime is not enough for `google.script.run`; the
  declarations must be static. See the CLAUDE.md gotcha.
