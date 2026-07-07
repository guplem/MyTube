// The footer's deploy indicator: shows when the served bundle was built, so a
// glance at the bottom of any screen confirms whether a deploy went live (a
// stale time means the old build is still being served).

import { formatBuildTimestamp } from "../shared/buildInfo";

// Replaced with the build moment (an ISO string) by esbuild's `define` in
// build.mjs. Guarded with `typeof` below so a bundle built without the define
// degrades to an empty footer instead of a ReferenceError.
declare const __BUILD_TIMESTAMP__: string;

/** Fill the shell's #build-stamp footer with the build time (local, "Deployed YYYY-MM-DD HH:MM"). */
export function renderBuildStamp(): void {
  const stamp = document.getElementById("build-stamp");
  if (!stamp) return;
  const iso = typeof __BUILD_TIMESTAMP__ === "string" ? __BUILD_TIMESTAMP__ : "";
  const formatted = formatBuildTimestamp(iso);
  if (!formatted) return;
  stamp.textContent = "Deployed " + formatted;
  // The exact UTC moment, for when the local rendering needs disambiguating.
  stamp.title = iso;
}
