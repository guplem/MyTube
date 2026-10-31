// The title casing cleanup: turns clickbait casing into sentence case, and
// keeps the words whose case carries meaning. See src/shared/sentenceCase.ts.

import { describe, expect, it } from "vitest";
import { toSentenceCase } from "../../src/shared/sentenceCase";

describe("toSentenceCase", () => {
  it("lower-cases a shouted title and capitalizes its first letter", () => {
    expect(toSentenceCase("THIS IS INSANE!!")).toBe("This is insane!!");
  });

  it("lower-cases a title written in title case", () => {
    expect(toSentenceCase("How To Build A Desk")).toBe("How to build a desk");
  });

  it("capitalizes the first letter of an all lower-case title", () => {
    expect(toSentenceCase("a quiet morning")).toBe("A quiet morning");
  });

  it("keeps a short all-capital word that is likely an acronym", () => {
    expect(toSentenceCase("The BEST GPU For The USA")).toBe(
      "The best GPU for the USA",
    );
    expect(toSentenceCase("Why NASA Went Back")).toBe("Why NASA went back");
  });

  it("keeps only 3-letter acronyms when most words are in capitals", () => {
    expect(toSentenceCase("BEST GPU EVER")).toBe("Best GPU ever");
    expect(toSentenceCase("WHY I QUIT MY JOB")).toBe("Why I quit my job");
    expect(toSentenceCase("NASA DID WHAT")).toBe("Nasa did what");
  });

  it("lower-cases a long all-capital word", () => {
    expect(toSentenceCase("This Is INSANE")).toBe("This is insane");
  });

  it("keeps a word with mixed case", () => {
    expect(toSentenceCase("My NEW iPhone And YouTube On macOS")).toBe(
      "My new iPhone and YouTube on macOS",
    );
  });

  it("keeps a word that has a digit", () => {
    // GTX1080TI has 5 letters, so only the digit rule keeps its case.
    expect(toSentenceCase("GTX1080TI VS PS5 In 4K")).toBe(
      "GTX1080TI vs PS5 in 4K",
    );
  });

  it("keeps the pronoun I in capitals", () => {
    expect(toSentenceCase("WHY I QUIT")).toBe("Why I quit");
  });

  it("lower-cases a capital word with an apostrophe", () => {
    expect(toSentenceCase("YOU WON'T BELIEVE IT")).toBe("You won't believe it");
    // The title does not shout, and IT'S has 3 letters, so only the
    // apostrophe rule lower-cases it.
    expect(toSentenceCase("You Won't Believe IT'S Back")).toBe(
      "You won't believe it's back",
    );
  });

  it("capitalizes the first word of every sentence", () => {
    expect(toSentenceCase("WOW. THIS IS HUGE! WHAT NOW?")).toBe(
      "Wow. This is huge! What now?",
    );
  });

  it("capitalizes the first word after leading punctuation", () => {
    expect(toSentenceCase('"WHAT" HAPPENED')).toBe('"What" happened');
  });

  it("leaves a first word with mixed case as it is", () => {
    expect(toSentenceCase("iPhone 16 REVIEW")).toBe("iPhone 16 review");
  });

  it("treats each part of a hyphenated word on its own", () => {
    expect(toSentenceCase("SELF-DRIVING CARS Use AI-Powered Chips")).toBe(
      "Self-driving cars use AI-powered chips",
    );
  });

  it("changes only letters that have case", () => {
    expect(toSentenceCase("日本 TRIP 2024")).toBe("日本 trip 2024");
    expect(toSentenceCase("")).toBe("");
  });

  it("keeps the spacing of the title", () => {
    expect(toSentenceCase("  BIG   NEWS ")).toBe("  Big   news ");
  });
});
