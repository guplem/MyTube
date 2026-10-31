// Counts in UI copy: "1 video", "1,284 videos". The copy is English, so the
// grouping is English too, whatever the browser locale.

const ENGLISH_GROUPING: Intl.NumberFormat = new Intl.NumberFormat("en-US");

export function groupedNumber(count: number): string {
  return ENGLISH_GROUPING.format(count);
}

export function countLabel(
  count: number,
  singular: string,
  plural: string,
): string {
  return groupedNumber(count) + " " + (count === 1 ? singular : plural);
}
