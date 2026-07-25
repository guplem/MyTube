// Shared optimistic-update primitive for buttons that hit the server and may be
// slow. The Apps Script bridge (google.script.run) round-trips to Google's
// servers, so a write can take a second or more. Rather than block the UI on the
// request, we assume success: apply the expected result to the UI immediately,
// fire the request in the background, and roll back + toast only if it fails.
// This keeps every action snappy even when the underlying call is slow.
//
// Every server-MUTATING control in the app funnels through here so they all feel
// instant and recover the same way. Reads (loading comments, a page of the feed,
// refreshing) are NOT optimistic — there is no result to assume — so they keep
// their own loading/skeleton state instead. See CLAUDE.md "Optimistic UI updates".

import { showToast } from "./toast";
import { dropUnservedFeedPages } from "./feedPageCache";

// Per-key tap counter: when a control is tapped repeatedly before its requests
// settle, only the LATEST tap owns the rollback. A stale request that fails
// later is ignored, because the newer tap already decided the UI and fired its
// own request; reverting the old one would diverge from both the user's last
// intent and the server's last write. Keyed on the button (a WeakMap so detached
// buttons are collected); callers that never re-tap (e.g. a one-shot remove) can
// omit the key and get a fresh, un-deduplicated slot.
const latestOp = new WeakMap<object, number>();

export interface OptimisticOptions {
  /** Apply the expected result to the UI now, before the request resolves. */
  apply: () => void;
  /** Undo `apply` when the request fails (and this is still the latest tap). */
  revert: () => void;
  /** Fire the server call; its rejection triggers the rollback. */
  send: () => Promise<void>;
  /** Toast shown when the request fails and the change is rolled back. */
  failMessage: string;
  /** Optional: run when the request succeeds (e.g. finalize a removal). */
  onSuccess?: () => void;
  /** Dedup key for rapid re-taps (usually the button). Omit for no dedup. */
  key?: object;
}

// Runs a server action optimistically. Applies the expected UI change, fires the
// request, and on failure rolls back and toasts — unless a newer tap on the same
// key has superseded this one.
export function optimistic(options: OptimisticOptions): void {
  const key = options.key ?? {};
  const op = (latestOp.get(key) ?? 0) + 1;
  latestOp.set(key, op);
  // Every server mutation flows through here, and any of them (seen, dismissed,
  // Watch Later) can change the flags baked into a feed page warmed in the
  // background — so drop those; the next screen render warms a fresh one. Pages
  // the feed already showed are NOT dropped: their Video objects are the ones
  // apply() is about to mutate, so they stay correct (see feedPageCache.ts).
  dropUnservedFeedPages();
  options.apply();
  options
    .send()
    .then((): void => {
      options.onSuccess?.();
    })
    .catch((): void => {
      if (latestOp.get(key) !== op) return; // superseded by a newer tap
      options.revert();
      showToast(options.failMessage);
    });
}
