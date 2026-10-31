// The one place browser code picks a scroll behavior. A smooth scroll is
// motion, and browsers do not calm it when the system asks to reduce
// motion, so this asks the media query on every call: the setting can
// change while the app is open. tests/ui/motion.test.ts fails on a
// "smooth" anywhere else in src/ui.
export function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}
