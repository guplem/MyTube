// Browser entry point. Runs in the page. Talks to the server through
// google.script.run, the Apps Script bridge for calling server functions.

// Minimal typing for the bridge calls this milestone uses. We extend this as we
// add more server calls.
interface GoogleScriptRunner {
  withSuccessHandler(callback: (value: string) => void): GoogleScriptRunner;
  withFailureHandler(callback: (error: Error) => void): GoogleScriptRunner;
  getActiveUserEmail(): void;
}
declare const google: { script: { run: GoogleScriptRunner } };

function showSignedInEmail(): void {
  const target = document.getElementById("email");
  if (!target) return;
  try {
    google.script.run
      .withSuccessHandler((email: string): void => {
        target.textContent = email || "(unknown account)";
      })
      .withFailureHandler((error: Error): void => {
        target.textContent = `server error: ${error.message}`;
      })
      .getActiveUserEmail();
  } catch (error) {
    // If the google.script.run bridge is not available yet, this surfaces the
    // problem on the page instead of leaving it stuck on "checking…".
    target.textContent = `bridge error: ${(error as Error).message}`;
  }
}

// Call only after the page (and the google.script bridge) is fully loaded.
// Calling at parse time can hit a not-yet-ready bridge and hang.
if (document.readyState === "complete") {
  showSignedInEmail();
} else {
  window.addEventListener("load", showSignedInEmail);
}
