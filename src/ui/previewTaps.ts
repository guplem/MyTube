// Carries the taps made on a list preview (a saved copy, ADR 0011) over to the
// fresh list. The preview's toggles act at once, but they change the preview's
// own Video objects. The fresh list holds other objects, and the server can
// have read it before the write landed. So the user's last tap is copied onto
// the fresh objects: first when the fresh list arrives, and again after every
// later tap while the preview stays on show (the update countdown, or "Show" after Cancel).

import type { Video } from "../shared/video";
import { carryPreviewTaps, type PreviewFlags } from "../shared/listSnapshot";
import { persistListSnapshots } from "./listSnapshots";
import { applyFeedNavState } from "./feedNavButton";

export function carryPreviewTapsToFresh(
  before: ReadonlyMap<string, PreviewFlags>,
  preview: readonly Video[],
  fresh: readonly Video[],
): void {
  if (!carryPreviewTaps(before, preview, fresh)) return;
  // The fresh objects are the ones the saved copies and the Feed nav button
  // read (the kept feed page, the Watch Later live source), so both follow.
  persistListSnapshots();
  applyFeedNavState();
}
