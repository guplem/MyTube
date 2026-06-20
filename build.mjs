// Builds the project into dist/, the folder clasp uploads to Apps Script.
//
// Two bundles:
//   1. Server TypeScript (src/server) -> dist/Code.js  (clasp pushes it as Code.gs)
//   2. Browser TypeScript (src/ui)     -> dist/ui.html  (a <script> block)
//
// dist/index.html includes dist/ui.html, and Apps Script serves index.html.
//
// Note: esbuild wraps each bundle in an IIFE. The server entry file
// (src/server/main.ts) must attach its entry points (doGet, include, and any
// function called from the browser) to globalThis, or Apps Script cannot find them.

import { build } from "esbuild";
import { mkdir, copyFile, writeFile } from "node:fs/promises";

const DIST = "dist";

await mkdir(DIST, { recursive: true });

// 1. Server bundle -> dist/Code.js
await build({
  entryPoints: ["src/server/main.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  outfile: `${DIST}/Code.js`,
  // Do not minify: keeping original names makes functions visible and debuggable
  // in the Apps Script editor.
  minify: false,
});

// 2. Browser bundle -> dist/ui.html (wrapped in a <script> tag)
const ui = await build({
  entryPoints: ["src/ui/main.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: false,
  write: false,
});
const browserJs = ui.outputFiles[0].text;
await writeFile(`${DIST}/ui.html`, `<script>\n${browserJs}\n</script>\n`);

// 3. Copy static files into dist/
await copyFile("src/ui/index.html", `${DIST}/index.html`);
await copyFile("appsscript.json", `${DIST}/appsscript.json`);

console.log("Build complete -> dist/ (Code.js, index.html, ui.html, appsscript.json)");
