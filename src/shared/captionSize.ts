// The caption size the viewer chose: what a stored value means, and which sizes
// the Settings picker offers. Kept out of src/ui/ so the rules are pinned by
// tests. The player reaches them through readStoredCaptionSize
// (src/ui/playerPreferences.ts).
//
// YouTube draws the captions inside its own iframe and scales them with the
// player's height, so theater mode and fullscreen get large captions. The page
// cannot style that iframe. The one control is the player's captions module:
// setOption("captions", "fontSize", step), where step is a position in YouTube's
// own "Font size" menu (0 is 100%). The IFrame API does not document this call.

/** YouTube's own size. Also the answer for anything unreadable. */
export const DEFAULT_CAPTION_SIZE: number = 0;

export interface CaptionSizeChoice {
  /** The step that setOption("captions", "fontSize", step) takes. */
  step: number;
  /** The label of the same step in YouTube's own "Font size" menu. */
  label: string;
}

/** The sizes the picker offers, smallest first, labelled like YouTube's menu. */
export const CAPTION_SIZE_CHOICES: readonly CaptionSizeChoice[] = [
  { step: -2, label: "50%" },
  { step: -1, label: "75%" },
  { step: 0, label: "100%" },
  { step: 1, label: "150%" },
  { step: 2, label: "200%" },
];

/** Reads a stored size. Anything that is not one of the offered steps falls
 *  back to YouTube's own size: the picker could not show it. */
export function parseCaptionSize(stored: string): number {
  // Number, not parseInt: parseInt reads "-1px" as -1, and a value with
  // trailing text is not one we wrote.
  const step = Number(stored);
  return CAPTION_SIZE_CHOICES.some((choice) => choice.step === step)
    ? step
    : DEFAULT_CAPTION_SIZE;
}
