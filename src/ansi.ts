// ANSI-aware width helpers.
//
// pi's TUI requires every rendered line to fit the width it was given; a line that
// overflows corrupts the whole frame, not just its own row. Styled text contains
// escape sequences that occupy no columns, so measuring with String#length and
// slicing with String#slice both produce wrong results on coloured text. These
// helpers measure and cut by visible columns while leaving escapes intact.
//
// Written locally rather than imported from pi so the extension stays free of
// runtime dependencies (a pi package with no install step is easier to trust).
//
// Limitation: widths are counted per Unicode code point, so East Asian
// double-width characters and combining marks are treated as single columns. The
// card renders box-drawing and block characters (all single-width) plus provider
// labels, so this is not currently reachable.

// Matches SGR (colour/style) sequences, which are the only escapes pi's themes emit.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI needs raw control chars.
const SGR = /\x1b\[[0-9;]*m/g;

/** Columns consumed by `text` once escape sequences are discounted. */
export function visibleWidth(text: string): number {
  return [...text.replace(SGR, "")].length;
}

/**
 * Cut `text` to at most `width` visible columns, appending `ellipsis` when
 * something was removed. Escape sequences encountered before the cut are preserved
 * so the truncated remainder keeps its styling.
 */
export function truncateToWidth(text: string, width: number, ellipsis = "…"): string {
  if (width <= 0) return "";
  if (visibleWidth(text) <= width) return text;

  const ellipsisWidth = visibleWidth(ellipsis);
  // Not enough room for the ellipsis itself: cut it down instead of overflowing.
  if (ellipsisWidth >= width) return [...ellipsis].slice(0, width).join("");

  const budget = width - ellipsisWidth;
  let visible = 0;
  let out = "";
  let cursor = 0;
  SGR.lastIndex = 0;

  for (let match = SGR.exec(text); match !== null; match = SGR.exec(text)) {
    for (const char of text.slice(cursor, match.index)) {
      if (visible >= budget) break;
      out += char;
      visible += 1;
    }
    if (visible >= budget) break;
    out += match[0];
    cursor = SGR.lastIndex;
  }

  for (const char of text.slice(cursor)) {
    if (visible >= budget) break;
    out += char;
    visible += 1;
  }

  return out + ellipsis;
}

/** Truncate if too long, pad if too short: exactly `width` visible columns. */
export function fitToWidth(text: string, width: number): string {
  if (width <= 0) return "";
  const fitted = truncateToWidth(text, width);
  return fitted + " ".repeat(Math.max(0, width - visibleWidth(fitted)));
}
