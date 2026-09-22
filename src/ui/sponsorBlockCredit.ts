// The footer's SponsorBlock and DeArrow credit. The player skips sponsor
// segments with data from SponsorBlock (src/server/sponsorBlock.ts), and the
// lists show community titles from DeArrow (src/server/dearrow.ts), a sister
// project on the same server. Both data sets are licensed CC BY-NC-SA 4.0,
// which requires a visible credit, so one line in the app footer credits both,
// next to the build stamp on every screen.
//
// Both links use double-quoted strings, never a backtick template literal:
// Apps Script's page serializer treats "//" inside a template literal as a
// line comment and corrupts the bundle (see setupSearch in src/ui/main.ts).

const SPONSORBLOCK_URL = "https://sponsor.ajay.app";
const DEARROW_URL = "https://dearrow.ajay.app";
const LICENCE_URL = "https://creativecommons.org/licenses/by-nc-sa/4.0/";

function footerLink(href: string, text: string): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = text;
  return link;
}

/** Fill the shell's #sponsorblock-credit footer slot with the required credits. */
export function renderSponsorBlockCredit(): void {
  const slot = document.getElementById("sponsorblock-credit");
  if (!slot) return;
  slot.replaceChildren(
    document.createTextNode("Skip data by "),
    footerLink(SPONSORBLOCK_URL, "SponsorBlock"),
    document.createTextNode(", titles by "),
    footerLink(DEARROW_URL, "DeArrow"),
    document.createTextNode(", "),
    footerLink(LICENCE_URL, "CC BY-NC-SA 4.0"),
  );
}
