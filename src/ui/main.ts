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
  google.script.run
    .withSuccessHandler((email: string): void => {
      const target = document.getElementById("email");
      if (target) target.textContent = email || "(unknown account)";
    })
    .withFailureHandler((error: Error): void => {
      const target = document.getElementById("email");
      if (target) target.textContent = `error: ${error.message}`;
    })
    .getActiveUserEmail();
}

showSignedInEmail();
