// The bordered HUD card actually drawn above the editor.
//
// Implements the plain Component interface (render(width): string[]) so it never
// takes focus from the editor, and knows nothing about any specific provider: it
// draws whatever snapshots the state hands it.
//
// Width contract: pi requires every line to fit the width it passes. A line that
// overflows corrupts the entire frame, not just its own row, so the card shrinks its
// inner width to whatever is available and truncates content to fit. Below a floor
// where nothing useful can be drawn it renders nothing at all, which is preferable
// to drawing a broken frame.
//
// The theme is read through a getter on every render rather than captured, because
// pi caches the component returned by setWidget() and only calls invalidate() on a
// theme change — a captured theme would stay stale after /settings.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { fitToWidth } from "./ansi.js";
import type { ExtensionConfig } from "./config.js";
import type { ProviderSnapshot, UsageWindow } from "./types.js";
import { renderBar } from "./widget.js";

/** Width the card uses when there is room: fits the widest realistic window line. */
const PREFERRED_INNER_WIDTH = 38;
/** Below this there is no point drawing a card; render nothing instead. */
const MIN_INNER_WIDTH = 8;
/** Right margin, and the minimum left gap required before right-aligning. */
const ALIGN_GAP = 2;
/** Past this age a snapshot is labelled, so stale data is never passed off as live. */
const STALE_AFTER_MS = 15 * 60_000;

type Colorize = (text: string) => string;

function colorFor(theme: Theme, window: UsageWindow, percent: number, config: ExtensionConfig): Colorize {
  // A provider reporting "critical" knows something thresholds do not, so prefer its
  // judgement unless the user explicitly asked for pure thresholds.
  if (config.colorMode === "provider-severity" && window.severity !== undefined) {
    const severity = window.severity.toLowerCase();
    if (severity === "critical" || severity === "error" || severity === "exceeded") {
      return (text) => theme.fg("error", text);
    }
    if (severity === "warning" || severity === "warn") {
      return (text) => theme.fg("warning", text);
    }
  }
  if (percent >= config.criticalPercent) return (text) => theme.fg("error", text);
  if (percent >= config.warnPercent) return (text) => theme.fg("warning", text);
  return (text) => theme.fg("success", text);
}

function formatCountdown(resetsAtSec: number | undefined, nowSec: number): string {
  if (resetsAtSec === undefined) return "";
  const delta = resetsAtSec - nowSec;
  if (delta <= 0) return " (reset due)";
  const days = Math.floor(delta / 86_400);
  const hours = Math.floor((delta % 86_400) / 3_600);
  const minutes = Math.floor((delta % 3_600) / 60);
  if (days > 0) return ` (${days}d${hours}h)`;
  if (hours > 0) return ` (${hours}h${minutes}m)`;
  return ` (${minutes}m)`;
}

/** Human-readable age, or empty while the snapshot is still fresh. */
export function formatAge(capturedAt: number, nowMs: number): string {
  const age = nowMs - capturedAt;
  if (age < STALE_AFTER_MS) return "";
  const minutes = Math.floor(age / 60_000);
  if (minutes < 60) return `${minutes}m old`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h old`;
  return `${Math.floor(hours / 24)}d old`;
}

/**
 * Pad every line so the card sits in the terminal's bottom-right corner. Falls back
 * to left alignment when there is no room for the card plus a visible gap.
 */
function applyAlign(lines: string[], align: string, width: number, totalWidth: number): string[] {
  if (align !== "right") return lines;
  const leftPad = width - ALIGN_GAP - totalWidth;
  if (leftPad <= 0) return lines;
  const padding = " ".repeat(leftPad);
  return lines.map((line) => padding + line);
}

export class UsageCard {
  private snapshots: ProviderSnapshot[] = [];
  private focusId: string | undefined;
  private expandedAll = false;

  constructor(
    private readonly getTheme: () => Theme,
    private readonly getConfig: () => ExtensionConfig,
  ) {}

  update(snapshots: ProviderSnapshot[], focusId: string | undefined, expandedAll: boolean): void {
    this.snapshots = snapshots;
    this.focusId = focusId;
    this.expandedAll = expandedAll;
  }

  invalidate(): void {
    // Nothing is cached beyond the snapshots; the theme and config are read live.
  }

  render(width: number): string[] {
    // Shrink to the space actually available: never assume PREFERRED_INNER_WIDTH fits.
    const inner = Math.min(PREFERRED_INNER_WIDTH, width - 2);
    if (inner < MIN_INNER_WIDTH) return [];

    const theme = this.getTheme();
    const config = this.getConfig();
    const border = (text: string) => theme.fg("border", text);
    const dim = (text: string) => theme.fg("dim", text);
    const rule = (left: string, right: string) => border(`${left}${"─".repeat(inner)}${right}`);
    const row = (text: string) => `${border("│")}${fitToWidth(text, inner)}${border("│")}`;

    // Focused mode shows only the provider backing the current model, mirroring how
    // jcode keeps the card tied to what you are actually using. When that provider
    // isn't tracked (or nothing is focused), fall back to listing everything.
    const focused = this.expandedAll
      ? []
      : this.snapshots.filter((snapshot) => snapshot.providerId === this.focusId);
    const list = focused.length > 0 ? focused : this.snapshots;

    const lines: string[] = [rule("╭", "╮")];
    const now = Date.now();

    list.forEach((snapshot, index) => {
      if (index > 0) lines.push(rule("├", "┤"));

      const age = formatAge(snapshot.capturedAt, now);
      const title = ` ${theme.bold(theme.fg("accent", snapshot.displayName))}`;
      lines.push(row(age === "" ? title : `${title} ${dim(age)}`));

      if (snapshot.status !== "ok") {
        lines.push(row(` ${dim(snapshot.reason ?? "unavailable")}`));
        return;
      }

      // Align bars across a provider's windows, so a long label like "rolling" does
      // not push its bar out of line with its neighbours.
      const labelWidth = Math.max(3, ...snapshot.windows.map((window) => window.label.length));
      for (const window of snapshot.windows) {
        lines.push(row(this.windowLine(window, labelWidth, config, dim)));
      }
      for (const metric of snapshot.metrics) {
        lines.push(row(` ${theme.bold(metric.value)} ${dim(metric.label)}`));
      }
      if (snapshot.windows.length === 0 && snapshot.metrics.length === 0) {
        lines.push(row(dim(" no data")));
      }
    });

    // Only worth offering the hint when something is actually hidden.
    if (focused.length > 0 && this.snapshots.length > 1) {
      lines.push(rule("├", "┤"));
      lines.push(row(` ${dim(`${this.snapshots.length} providers · /usage all`)}`));
    }

    lines.push(rule("╰", "╯"));
    return applyAlign(lines, config.align, width, inner + 2);
  }

  private windowLine(
    window: UsageWindow,
    labelWidth: number,
    config: ExtensionConfig,
    dim: (text: string) => string,
  ): string {
    const label = dim(window.label.padEnd(labelWidth, " "));

    if (window.usedPercent === undefined) {
      return ` ${label} ${dim("n/a")}`;
    }

    const percent = Math.round(window.usedPercent);
    const color = colorFor(this.getTheme(), window, percent, config);
    const countdown = formatCountdown(window.resetsAtSec, Math.floor(Date.now() / 1000));
    return ` ${label} ${color(renderBar(percent))} ${color(`${String(percent).padStart(3, " ")}%`)}${dim(countdown)}`;
  }
}
