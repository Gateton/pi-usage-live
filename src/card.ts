// A small, bordered, colored "HUD card" component — this is what actually gets
// rendered on screen above the editor. Implements the plain Component interface
// (render(width): string[]) so it never steals focus from the editor.
//
// The theme is read through a getter on every render rather than captured, because
// Pi caches the component returned by setWidget() and only calls invalidate() on a
// theme change — a captured Theme would go stale after /settings switches themes.
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ProviderSnapshot, UsageWindow } from "./types.js";
import { renderBar } from "./widget.js";

const CARD_WIDTH = 30; // inner content width; borders add 2 more columns
const CARD_TOTAL_WIDTH = CARD_WIDTH + 2;
/** Right margin so the card doesn't touch the terminal edge; also the minimum gap
 *  required on the left before we allow right-alignment at all. */
const ALIGN_GAP = 2;

export type CardAlign = "left" | "right";

function colorForPercent(theme: Theme, percent: number): (s: string) => string {
  if (percent >= 85) return (s: string) => theme.fg("error", s);
  if (percent >= 60) return (s: string) => theme.fg("warning", s);
  return (s: string) => theme.fg("success", s);
}

function pad(s: string, width: number): string {
  // theme.fg() wraps text in ANSI codes; measure/pad against the raw text length instead.
  const visibleLen = stripAnsi(s).length;
  return s + " ".repeat(Math.max(0, width - visibleLen));
}

function stripAnsi(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping needs raw control chars.
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Pad every line on the left so the card sits in the terminal's bottom-right
 * corner like a HUD panel. Falls back to left-alignment when the terminal is too
 * narrow to fit the card plus a visible gap — a clipped card is worse than a
 * left-aligned one.
 */
function applyAlign(lines: string[], align: CardAlign, width: number): string[] {
  if (align === "left") return lines;
  const leftPad = width - ALIGN_GAP - CARD_TOTAL_WIDTH;
  if (leftPad <= 0) return lines;
  const padStr = " ".repeat(leftPad);
  return lines.map((line) => padStr + line);
}

export class UsageCard {
  private getTheme: () => Theme;
  private snapshots: ProviderSnapshot[] = [];
  private focusId: ProviderSnapshot["providerId"] | undefined;
  private expanded = false;
  private align: CardAlign = "right";

  constructor(getTheme: () => Theme) {
    this.getTheme = getTheme;
  }

  update(snapshots: ProviderSnapshot[], focusId: ProviderSnapshot["providerId"] | undefined, expanded: boolean): void {
    this.snapshots = snapshots;
    this.focusId = focusId;
    this.expanded = expanded;
  }

  setAlign(align: CardAlign): void {
    this.align = align;
  }
  getAlign(): CardAlign {
    return this.align;
  }

  invalidate(): void {
    // Nothing cached beyond the snapshots, and the theme is read live in render().
  }

  render(width: number): string[] {
    const theme = this.getTheme();
    const border = (s: string) => theme.fg("border", s);
    const dim = (s: string) => theme.fg("dim", s);
    const accent = (s: string) => theme.fg("accent", s);

    const shown = this.expanded
      ? this.snapshots
      : this.snapshots.filter((s) => s.providerId === this.focusId).slice(0, 1);
    const list = shown.length > 0 ? shown : this.snapshots.slice(0, 1);

    const lines: string[] = [];
    lines.push(border(`╭${"─".repeat(CARD_WIDTH)}╮`));

    list.forEach((snapshot, idx) => {
      if (idx > 0) lines.push(border(`├${"─".repeat(CARD_WIDTH)}┤`));
      const title = ` ${theme.bold(accent(snapshot.displayName))}`;
      lines.push(`${border("│")}${pad(title, CARD_WIDTH)}${border("│")}`);

      if (snapshot.status !== "ok") {
        const text = ` ${dim(`unavailable${snapshot.reason ? ` — ${snapshot.reason}` : ""}`)}`;
        lines.push(`${border("│")}${pad(text, CARD_WIDTH)}${border("│")}`);
        return;
      }

      // Align bars across a snapshot's windows: "rolling" vs "wk" would otherwise
      // push the bar sideways and make the card look ragged.
      const labelWidth = Math.max(3, ...snapshot.windows.map((w) => w.label.length));
      for (const w of snapshot.windows) lines.push(...this.windowLines(w, labelWidth, border, dim));
      for (const m of snapshot.metrics) {
        const text = ` ${theme.bold(m.value)} ${dim(m.label)}`;
        lines.push(`${border("│")}${pad(text, CARD_WIDTH)}${border("│")}`);
      }
      if (snapshot.windows.length === 0 && snapshot.metrics.length === 0) {
        lines.push(`${border("│")}${pad(dim(" no data"), CARD_WIDTH)}${border("│")}`);
      }
    });

    if (!this.expanded && this.snapshots.length > 1) {
      const hint = ` ${dim(`+${this.snapshots.length - 1} more · /usage all`)}`;
      lines.push(border(`├${"─".repeat(CARD_WIDTH)}┤`));
      lines.push(`${border("│")}${pad(hint, CARD_WIDTH)}${border("│")}`);
    }

    lines.push(border(`╰${`─`.repeat(CARD_WIDTH)}╯`));
    return applyAlign(lines, this.align, width);
  }

  private windowLines(
    w: UsageWindow,
    labelWidth: number,
    border: (s: string) => string,
    dim: (s: string) => string,
  ): string[] {
    const pct = w.usedPercent !== undefined ? Math.round(w.usedPercent) : undefined;
    if (pct === undefined) {
      const text = ` ${dim(`${w.label}: n/a`)}`;
      return [`${border("│")}${pad(text, CARD_WIDTH)}${border("│")}`];
    }
    const color = colorForPercent(this.getTheme(), pct);
    const bar = color(renderBar(pct));
    const pctText = color(`${String(pct).padStart(3, " ")}%`);
    const label = dim(w.label.padEnd(labelWidth, " "));
    const text = ` ${label} ${bar} ${pctText}`;
    return [`${border("│")}${pad(text, CARD_WIDTH)}${border("│")}`];
  }
}
