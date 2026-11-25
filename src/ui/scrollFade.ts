// Fade the start edge of a sideways strip once it scrolls. The phone strips
// (the nav tabs, the feed filters, the chapter strip) always fade their end
// edge in CSS, over the end padding. A fixed fade at the start would blur the
// first chip at rest, so the start fade shows only while the strip sits away
// from its start: this module sets `strip--scrolled` and the CSS reads it.
// One capturing listener on the document reaches every strip, also the ones
// that a screen builds later, because a scroll event does not bubble.

const STRIP_SELECTOR: string =
  ".app-nav, .feed-filters, .player-chapters-track";

export function installScrollFades(): void {
  document.addEventListener(
    "scroll",
    (event: Event): void => {
      const target: EventTarget | null = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.matches(STRIP_SELECTOR)) return;
      target.classList.toggle("strip--scrolled", target.scrollLeft > 0);
    },
    { capture: true, passive: true },
  );
}
