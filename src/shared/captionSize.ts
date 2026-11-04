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
//
// The viewer picks one size, for every mode. The chosen size is the size in
// the normal desktop player. A taller player (theater mode, fullscreen) gets a
// smaller step that cancels YouTube's growth (captionSizeStep), so the text
// stays the same size on the screen. A smaller player (a phone) keeps the
// chosen step: YouTube's own scaling already fits it there.

/** YouTube's own size. Also the answer for anything unreadable. */
export const DEFAULT_CAPTION_SIZE: number = 0;

export interface CaptionSizeChoice {
  /** The step that setOption("captions", "fontSize", step) takes. */
  step: number;
  /** The label of the same step in YouTube's own "Font size" menu. */
  label: string;
  /** The same step as a factor of YouTube's own size. */
  scale: number;
}

/** The sizes the picker offers, smallest first, labelled like YouTube's menu. */
export const CAPTION_SIZE_CHOICES: readonly CaptionSizeChoice[] = [
  { step: -2, label: "50%", scale: 0.5 },
  { step: -1, label: "75%", scale: 0.75 },
  { step: 0, label: "100%", scale: 1 },
  { step: 1, label: "150%", scale: 1.5 },
  { step: 2, label: "200%", scale: 2 },
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

/** The height in pixels of the normal desktop player: 900px wide
 *  (.player-view in src/ui/index.html), 16:9. */
export const CAPTION_REFERENCE_HEIGHT: number = (900 * 9) / 16;

/** The step to apply in a player of this height, so captions keep the size
 *  that `chosenStep` gives in the normal desktop player. YouTube scales the
 *  captions with the player's height, so a taller player gets a smaller step.
 *  The steps are coarse, so the answer is the nearest step on a ratio scale. */
export function captionSizeStep(
  chosenStep: number,
  playerHeight: number,
): number {
  const chosen: CaptionSizeChoice | undefined = CAPTION_SIZE_CHOICES.find(
    (choice) => choice.step === chosenStep,
  );
  if (!chosen) return DEFAULT_CAPTION_SIZE;
  // A player not laid out yet reports 0, and a smaller player needs no
  // change: only a taller one makes YouTube's captions too large.
  if (!(playerHeight > CAPTION_REFERENCE_HEIGHT)) return chosenStep;
  const target: number =
    (chosen.scale * CAPTION_REFERENCE_HEIGHT) / playerHeight;
  let best: CaptionSizeChoice = chosen;
  for (const choice of CAPTION_SIZE_CHOICES) {
    // A ratio scale: 0.67 is nearer 0.75 (x1.125) than 0.5 (x1.33).
    if (
      Math.abs(Math.log(choice.scale / target)) <
      Math.abs(Math.log(best.scale / target))
    )
      best = choice;
  }
  return best.step;
}
