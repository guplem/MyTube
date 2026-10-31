// The title casing cleanup: turns clickbait casing ("THIS IS INSANE!!") into
// sentence case ("This is insane!!"). Shared so the browser applies the same
// rule that the tests pin. The browser applies it at render time to the title
// on show (pickDisplayTitle in src/shared/dearrow.ts), so the stored title
// never changes and the Settings switch needs no refetch.
//
// The rule has no dictionary, so it guesses which words carry their case on
// purpose:
// - A word with mixed case ("iPhone", "YouTube") keeps it.
// - A word with a digit ("PS5", "4K") keeps its case: it is a model name.
// - A short all-capital word ("GPU", "NASA") keeps it, as a likely acronym,
//   unless it is a common English word ("THIS", "BEST").
// - Every other word goes to lower case, and the first word of each sentence
//   gets a capital first letter.
// Proper nouns in title case ("Apple") go to lower case. That is the cost of
// the guess, and why the switch exists.

// When more than half of the words are all capitals, the title shouts, and an
// all-capital word says nothing about intent. Only 3-letter acronyms then keep
// their case; otherwise up to 4 letters do.
const ACRONYM_MAX_LETTERS = 4;
const SHOUTING_ACRONYM_MAX_LETTERS = 3;

// Common words of 2 to 4 letters that a shouted title writes in capitals. An
// all-capital word in this list is never an acronym. "US" is left out: in
// capitals it usually means the United States.
const COMMON_WORDS: ReadonlySet<string> = new Set<string>(
  (
    "am an as at be by do go he if in is it me my no of oh ok on or so to up vs we " +
    "ago all and any are ask bad big boy but buy can car cut day did die dog eat " +
    "end far few fix for fun get god got guy had has her hey him his hit hot how " +
    "its job let lie lot low mad man may men mom new not now odd off old one our " +
    "out own pay put ran red run sad saw say see she six ten the too top try two " +
    "use war was way who why win won wow yes yet you " +
    "also away back been best body book both came cars come cool dead does done " +
    "down each easy epic even ever evil fail fake fast fear feel find fire five " +
    "food four free from full game gave girl give gone good half hard hate have " +
    "help here high home huge idea into just keep kill kind knew know last left " +
    "less life like live long look lost love made make many more most much must " +
    "need next nice nine once only open over part play quit real rich said same " +
    "save says self shot show side sold some stop such sure take talk tell than " +
    "that them then they this time took true turn very want week well went were " +
    "what when will wins with word work year your zero"
  ).split(" "),
);

// A word: letters, combining marks, digits, and apostrophes inside a word
// ("WON'T"). Hyphens and other punctuation split words, so each part of
// "AI-POWERED" is judged on its own.
const WORD_PATTERN = /[\p{L}\p{M}\p{N}'’]+/gu;
const UPPER = /\p{Lu}/u;
const LOWER = /\p{Ll}/u;
const DIGIT = /\p{N}/u;
const LETTER = /\p{L}/gu;
// Text between two words that ends a sentence: ".", "!" or "?" then a space.
const SENTENCE_END = /[.!?]["'’”)\]]*\s/u;

function letterCount(word: string): number {
  return (word.match(LETTER) ?? []).length;
}

function isAllCaps(word: string): boolean {
  return UPPER.test(word) && !LOWER.test(word);
}

// A capital after the first character, next to a lower-case letter.
function hasMixedCase(word: string): boolean {
  return LOWER.test(word) && UPPER.test(word.slice(1));
}

function keepsCase(word: string, shouting: boolean): boolean {
  if (hasMixedCase(word) || DIGIT.test(word)) return true;
  if (!isAllCaps(word)) return false;
  const letters = letterCount(word);
  if (letters === 1) return word !== "A";
  // An apostrophe marks a word ("DON'T"), never an acronym.
  if (/['’]/u.test(word)) return false;
  const max = shouting ? SHOUTING_ACRONYM_MAX_LETTERS : ACRONYM_MAX_LETTERS;
  return letters <= max && !COMMON_WORDS.has(word.toLowerCase());
}

function capitalizeFirstLetter(word: string): string {
  return word.replace(LOWER, (letter: string): string => letter.toUpperCase());
}

/** Rewrites a title in sentence case, keeping the case of the words that
 *  likely carry it on purpose (see the rules at the top of this file). */
export function toSentenceCase(title: string): string {
  const words: string[] = title.match(WORD_PATTERN) ?? [];
  // Left out of the count: single letters ("I", "A"), model names, and words
  // in a script without case ("日本"). None of them says whether the title
  // shouts.
  const judged = words.filter(
    (word: string): boolean =>
      letterCount(word) >= 2 &&
      !DIGIT.test(word) &&
      (UPPER.test(word) || LOWER.test(word)),
  );
  const shouting =
    judged.filter(isAllCaps).length * 2 > judged.length && judged.length > 0;

  let lastEnd = 0;
  let isFirst = true;
  return title.replace(WORD_PATTERN, (word: string, offset: number): string => {
    const startsSentence =
      isFirst || SENTENCE_END.test(title.slice(lastEnd, offset));
    isFirst = false;
    lastEnd = offset + word.length;
    if (keepsCase(word, shouting)) return word;
    const lower = word.toLowerCase();
    return startsSentence ? capitalizeFirstLetter(lower) : lower;
  });
}
