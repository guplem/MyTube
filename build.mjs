// Builds the project into dist/, the folder clasp uploads to Apps Script.
//
// Two bundles:
//   1. Server TypeScript (src/server) -> dist/Code.js  (clasp pushes it as Code.gs)
//   2. Browser TypeScript (src/ui)     -> dist/ui.html  (a <script> block)
//
// dist/index.html includes dist/ui.html, and Apps Script serves index.html.
//
// Key detail: Apps Script only exposes a function to google.script.run / web app
// entry points if it appears as a TOP-LEVEL function declaration in the pushed
// file. esbuild wraps the bundle in an IIFE, hiding our declarations. So for the
// server bundle we read every `export function` name from src/server/main.ts and
// append top-level wrapper functions that forward into the bundle.

import { build } from "esbuild";
import { mkdir, copyFile, writeFile, readFile } from "node:fs/promises";

const DIST = "dist";
const SERVER_ENTRY = "src/server/main.ts";

await mkdir(DIST, { recursive: true });

// 1. Server bundle -> dist/Code.js
// Discover the functions to expose (every `export function` in the entry file).
const serverSource = await readFile(SERVER_ENTRY, "utf8");
const exposedFunctions = [
  ...serverSource.matchAll(/export\s+function\s+(\w+)/g),
].map((match) => match[1]);
if (exposedFunctions.length === 0) {
  throw new Error(
    `No "export function" found in ${SERVER_ENTRY}; nothing would be callable.`,
  );
}
console.log(
  "Exposing server functions to Apps Script:",
  exposedFunctions.join(", "),
);

// Top-level wrappers that Apps Script can find, each forwarding to the bundle
// (esbuild stores the entry's exports on the global __server when globalName is set).
const globalWrappers = exposedFunctions
  .map(
    (name) =>
      `function ${name}() { return __server.${name}.apply(__server, arguments); }`,
  )
  .join("\n");

await build({
  entryPoints: [SERVER_ENTRY],
  bundle: true,
  format: "iife",
  globalName: "__server",
  target: "es2020",
  outfile: `${DIST}/Code.js`,
  // Do not minify: keeping original names makes functions visible and debuggable
  // in the Apps Script editor.
  minify: false,
  footer: { js: globalWrappers },
});

// 2. Browser bundle -> dist/ui.html (wrapped in a <script> tag)
// The build moment is stamped into the bundle: the page footer shows it as a
// deploy indicator (src/ui/buildStamp.ts). Both deploy paths (npm run deploy,
// .github/workflows/deploy.yml) rebuild right before `clasp deploy`, so a new
// timestamp at the bottom of the page means the deploy went live.
const buildTimestamp = new Date().toISOString();
const ui = await build({
  entryPoints: ["src/ui/main.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: false,
  write: false,
  define: { __BUILD_TIMESTAMP__: JSON.stringify(buildTimestamp) },
});
const browserJs = ui.outputFiles[0].text;
await writeFile(`${DIST}/ui.html`, `<script>\n${browserJs}\n</script>\n`);

// 3. Copy static files into dist/
await copyFile("src/ui/index.html", `${DIST}/index.html`);
await copyFile("appsscript.json", `${DIST}/appsscript.json`);

console.log(
  "Build complete -> dist/ (Code.js, index.html, ui.html, appsscript.json)",
);
