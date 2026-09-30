// Keeps the screen on while a video plays, like the native YouTube app. The
// embedded player plays inside two nested iframes (the Apps Script wrapper,
// then YouTube's own), and phones do not treat that playback as a reason to
// stay awake, so the screen dims and locks mid-video. The Screen Wake Lock API
// asks for it explicitly.
//
// The browser drops the lock on its own whenever the page is hidden (tab
// switch, screen off), so a visible page that still wants the lock asks again.
// Every failure is swallowed: an old browser without the API, or a frame whose
// permissions policy blocks it, just falls back to the device's normal timeout.

export interface ScreenWakeLockHolder {
  // true while a video plays, false on pause or end.
  setWanted(wanted: boolean): void;
  // Drops the lock for good. Call it when the owner is destroyed.
  release(): void;
}

export function createScreenWakeLockHolder(): ScreenWakeLockHolder {
  let wanted = false;
  let sentinel: WakeLockSentinel | null = null;
  let requesting = false;

  async function acquire(): Promise<void> {
    if (sentinel || requesting || !("wakeLock" in navigator)) return;
    if (document.visibilityState !== "visible") return;
    requesting = true;
    try {
      const acquired: WakeLockSentinel =
        await navigator.wakeLock.request("screen");
      // The video paused (or the player closed) while the request was in
      // flight, so a lock granted now would keep the screen on for nothing.
      if (!wanted) {
        void acquired.release().catch((): void => {});
        return;
      }
      sentinel = acquired;
      acquired.addEventListener("release", (): void => {
        if (sentinel === acquired) sentinel = null;
      });
    } catch {
      // Blocked by the frame's permissions policy, or refused (low battery).
    } finally {
      requesting = false;
    }
  }

  function drop(): void {
    const held = sentinel;
    sentinel = null;
    if (held) void held.release().catch((): void => {});
  }

  const onVisibilityChange = (): void => {
    if (wanted) void acquire();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  return {
    setWanted: (next: boolean): void => {
      wanted = next;
      if (wanted) void acquire();
      else drop();
    },
    release: (): void => {
      wanted = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      drop();
    },
  };
}
