// The title casing cleanup: tones down words in capitals and keeps the
// casing style that the uploader chose. See src/shared/titleCase.ts.

import { describe, expect, it } from "vitest";
import { fixTitleCase } from "../../src/shared/titleCase";

describe("fixTitleCase", () => {
  it("lower-cases a shouted title and capitalizes its first letter", () => {
    expect(fixTitleCase("THIS IS INSANE!!")).toBe("This is insane!!");
  });

  it("keeps a title written in title case", () => {
    expect(fixTitleCase("How To Build A Desk")).toBe("How To Build A Desk");
    expect(
      fixTitleCase(
        "Sequel to Space Race Gets Real - Deep Space Updates November 3rd",
      ),
    ).toBe("Sequel to Space Race Gets Real - Deep Space Updates November 3rd");
  });

  it("keeps the capitals of a proper noun in a sentence-case title", () => {
    expect(fixTitleCase("My trip to Japan was AMAZING")).toBe(
      "My trip to Japan was amazing",
    );
  });

  it("leaves the first word out when it judges the style of the title", () => {
    // Counted with the first word, 2 of 3 words have a capital, and GREAT
    // would wrongly become "Great".
    expect(fixTitleCase("Review: Camera is GREAT")).toBe(
      "Review: Camera is great",
    );
  });

  it("capitalizes the first letter of an all lower-case title", () => {
    expect(fixTitleCase("a quiet morning")).toBe("A quiet morning");
  });

  it("gives a word in capitals the title-case style of its title", () => {
    expect(fixTitleCase("This Is INSANE")).toBe("This Is Insane");
    expect(fixTitleCase("Apple Just Did WHAT?!")).toBe("Apple Just Did What?!");
  });

  it("keeps a small word lower case in a title-case title", () => {
    // GTX1080TI has 5 letters, so only the digit rule keeps its case.
    expect(fixTitleCase("GTX1080TI VS PS5 In 4K")).toBe(
      "GTX1080TI vs PS5 In 4K",
    );
  });

  it("keeps a short all-capital word that is likely an acronym", () => {
    expect(fixTitleCase("The BEST GPU For The USA")).toBe(
      "The Best GPU For The USA",
    );
    expect(fixTitleCase("Why NASA Went Back")).toBe("Why NASA Went Back");
  });

  it("keeps only 3-letter acronyms when most words are in capitals", () => {
    expect(fixTitleCase("BEST GPU EVER")).toBe("Best GPU ever");
    expect(fixTitleCase("WHY I QUIT MY JOB")).toBe("Why I quit my job");
    expect(fixTitleCase("NASA DID WHAT")).toBe("Nasa did what");
  });

  it("keeps a word with mixed case", () => {
    expect(fixTitleCase("My NEW iPhone And YouTube On macOS")).toBe(
      "My New iPhone And YouTube On macOS",
    );
  });

  it("keeps the pronoun I in capitals", () => {
    expect(fixTitleCase("WHY I QUIT")).toBe("Why I quit");
  });

  it("lower-cases a capital word with an apostrophe", () => {
    expect(fixTitleCase("YOU WON'T BELIEVE IT")).toBe("You won't believe it");
    // The title does not shout, and IT'S has 3 letters, so only the
    // apostrophe rule rewrites it.
    expect(fixTitleCase("You Won't Believe IT'S Back")).toBe(
      "You Won't Believe It's Back",
    );
  });

  it("capitalizes the first word of every sentence", () => {
    expect(fixTitleCase("WOW. THIS IS HUGE! WHAT NOW?")).toBe(
      "Wow. This is huge! What now?",
    );
  });

  it("capitalizes the first word after leading punctuation", () => {
    expect(fixTitleCase('"WHAT" HAPPENED')).toBe('"What" happened');
  });

  it("leaves a first word with mixed case as it is", () => {
    expect(fixTitleCase("iPhone 16 REVIEW")).toBe("iPhone 16 review");
  });

  it("treats each part of a hyphenated word on its own", () => {
    expect(fixTitleCase("SELF-DRIVING CARS Use AI-Powered Chips")).toBe(
      "Self-driving cars use AI-powered chips",
    );
  });

  it("changes only letters that have case", () => {
    expect(fixTitleCase("日本 TRIP 2024")).toBe("日本 trip 2024");
    expect(fixTitleCase("")).toBe("");
  });

  it("keeps the spacing of the title", () => {
    expect(fixTitleCase("  BIG   NEWS ")).toBe("  Big   news ");
  });
});
