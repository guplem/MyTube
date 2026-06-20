// Server entry point. Runs on Google's servers as the logged-in user
// (deploy setting "Execute as: user accessing the web app").
//
// EXPORT every function that must be reachable from outside: the web app entry
// point doGet, and every function the browser calls through google.script.run.
// Apps Script only exposes functions that appear as top-level declarations in
// the pushed file. esbuild hides ours inside an IIFE, so build.mjs reads these
// `export function` names and appends matching top-level wrappers to the bundle.

/** Serves the single web app page. Called by Apps Script for GET requests. */
export function doGet(): GoogleAppsScript.HTML.HtmlOutput {
  return HtmlService.createTemplateFromFile("index")
    .evaluate()
    .setTitle("MyTube")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

/** Inlines another HTML file into a template (used by index.html for the UI bundle). */
export function include(filename: string): string {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** Returns the email of the logged-in user. Called from the browser to prove login works. */
export function getActiveUserEmail(): string {
  return Session.getActiveUser().getEmail();
}
