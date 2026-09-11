---
name: rename-symbol
description: Rename or refactor a symbol safely by searching every naming-case variant across code, tests, docs, configs, and JSON. Use when renaming any identifier so no reference is missed.
---

# Rename a symbol safely

When you rename or refactor any symbol, search **all** naming variants (camelCase, PascalCase, snake_case, kebab-case, UPPER_CASE) across the whole project (code, tests, docs, configs, and JSON), not just the obvious code references. A missed variant in a config key or a data file is the usual cause of a rename that compiles fine but breaks at runtime.

Extra traps in this repo:

- **`dist/` is generated; never edit it by hand.** Re-run `npm run build` after the rename and confirm no stale references remain in the bundle.
- **Exported server functions are a public API.** `build.mjs` generates the top-level Apps Script wrappers from the exports of `src/server/main.ts`, and the browser calls them by name through `google.script.run.<name>`. Renaming an exported server function means updating every `google.script.run` call site in `src/ui/`, and it changes the deployed API surface. Grep for the function name as a string, not only as a symbol.
- **Changing what a parameter _means_ is invisible to the compiler when its type widens.** A caller passing `boolean` still compiles after the parameter becomes `boolean | null`, so every stale call site keeps sending the old meaning. After any change to a parameter's meaning, not only after a rename, grep for the old parameter name and re-read every call site.
- **A refactor that re-points callers from one function to another leaves stale comments that no grep can flag.** The old function still exists and its name still resolves, so every mention still looks correct. After you move the callers, re-read every comment and doc line that names the old function, and confirm each one still describes what happens now.
- **Stored property keys are a storage schema.** History, dismissed, progress, and preference keys are persisted (per-user script properties, or `localStorage`). Renaming the code symbol is safe, but renaming the stored key breaks existing saved data and needs an explicit migration, not just a find-and-replace.
