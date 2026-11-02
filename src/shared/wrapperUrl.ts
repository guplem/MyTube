// The message that keeps the installable wrapper's address bar in step with
// the app. The wrapper (pages/index.html) frames the Apps Script page, so
// google.script.history changes only the framed page's URL, never the one
// the user sees, copies, shares or reloads. The app posts each screen's
// params to the top window, and the wrapper writes them into its own URL.
// The wrapper is plain HTML with no build step, so it repeats the type and
// the origin; tests/shared/wrapperUrl.test.ts pins that both sides agree.

/** The wrapper's origin. The app posts only to it, so a page on any other
 *  origin that frames the app learns nothing, and the browser drops the
 *  message when no wrapper is there (the plain Apps Script URL). */
export const WRAPPER_ORIGIN = "https://triunitystudios.com";

export const WRAPPER_URL_MESSAGE_TYPE = "mytube:url";

export interface WrapperUrlMessage {
  type: typeof WRAPPER_URL_MESSAGE_TYPE;
  params: { [key: string]: string };
}

/** Builds the message that tells the wrapper the params of the screen on show. */
export function wrapperUrlMessage(params: {
  [key: string]: string;
}): WrapperUrlMessage {
  return { type: WRAPPER_URL_MESSAGE_TYPE, params: { ...params } };
}
