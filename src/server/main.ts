// Server entry point. Runs on Google's servers as the logged-in user
// (deploy setting "Execute as: user accessing the web app").

/** Serves the single web app page. Called by Apps Script for GET requests. */
function doGet(): GoogleAppsScript.HTML.HtmlOutput {
  return HtmlService.createTemplateFromFile("index")
    .evaluate()
    .setTitle("MyTube")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

/** Inlines another HTML file into a template (used by index.html for the UI bundle). */
function include(filename: string): string {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** Returns the email of the logged-in user. Called from the browser to prove login works. */
function getActiveUserEmail(): string {
  return Session.getActiveUser().getEmail();
}

// Apps Script looks up entry points (doGet) and google.script.run targets on the
// global scope. esbuild wraps this file in an IIFE, so we attach them explicitly.
// Every new function the browser calls must be added here.
const globalScope = globalThis as unknown as Record<string, unknown>;
globalScope.doGet = doGet;
globalScope.include = include;
globalScope.getActiveUserEmail = getActiveUserEmail;
