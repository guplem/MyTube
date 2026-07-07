// When the served bundle was built. build.mjs stamps the build moment into
// the browser bundle (esbuild `define`, see src/ui/buildStamp.ts), and both
// deploy paths (`npm run deploy`, .github/workflows/deploy.yml) rebuild right
// before `clasp deploy` — so the stamp at the bottom of the page tells at a
// glance whether a deploy actually went live. The formatting lives here, not
// in src/ui/, so the Node test suite covers it.

/**
 * Format a build timestamp (ISO 8601) for the page footer: the viewer's local
 * time as "YYYY-MM-DD HH:MM", or "" when the input does not parse (the footer
 * stays empty rather than showing a bogus date).
 */
export function formatBuildTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number): string => String(value).padStart(2, "0");
  const datePart = date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  const timePart = pad(date.getHours()) + ":" + pad(date.getMinutes());
  return datePart + " " + timePart;
}
