// The footer's SponsorBlock credit. The player skips sponsor segments with
// data from SponsorBlock (src/server/sponsorBlock.ts). That data is licensed
// CC BY-NC-SA 4.0, which requires a visible credit, so this sits in the app
// footer next to the build stamp on every screen.
//
// Both links use double-quoted strings, never a backtick template literal:
// Apps Script's page serializer treats "//" inside a template literal as a
// line comment and corrupts the bundle (see setupSearch in src/ui/main.ts).

const SPONSORBLOCK_URL = "https://sponsor.ajay.app";
const LICENCE_URL = "https://creativecommons.org/licenses/by-nc-sa/4.0/";

function footerLink(href: string, text: string): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = text;
  return link;
}

/** Fill the shell's #sponsorblock-credit footer slot with the required credit. */
export function renderSponsorBlockCredit(): void {
  const slot = document.getElementById("sponsorblock-credit");
  if (!slot) return;
  slot.replaceChildren(
    document.createTextNode("Skip data by "),
    footerLink(SPONSORBLOCK_URL, "SponsorBlock"),
    document.createTextNode(", "),
    footerLink(LICENCE_URL, "CC BY-NC-SA 4.0"),
  );
}
