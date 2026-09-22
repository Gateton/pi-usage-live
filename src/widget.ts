// Formats ProviderSnapshot[] into the plain-text lines rendered by ctx.ui.setWidget().
// Bar style mirrors jcode's `jcode usage`: 15-cell ASCII bar + percent.
import type { ProviderSnapshot } from "./types.js";

const BAR_WIDTH = 15;

export function renderBar(percent: number): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * BAR_WIDTH);
  return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
}

function formatCountdown(resetsAtSec: number | undefined, nowSec: number): string {
  if (resetsAtSec === undefined) return "";
  const deltaSec = resetsAtSec - nowSec;
  if (deltaSec <= 0) return " (resetting)";
  const days = Math.floor(deltaSec / 86400);
  const hours = Math.floor((deltaSec % 86400) / 3600);
  const minutes = Math.floor((deltaSec % 3600) / 60);
  if (days > 0) return ` (resets ${days}d${hours}h)`;
  if (hours > 0) return ` (resets ${hours}h${minutes}m)`;
  return ` (resets ${minutes}m)`;
}

function padLabel(label: string, width: number): string {
  return label.length >= width ? `${label} ` : label + " ".repeat(width - label.length);
}

/**
 * Plain-text lines (no color codes) for the widget. Callers that want theming can
 * wrap this in theme.fg(...) per-line; keeping this pure and color-free makes it
 * trivially unit-testable and reusable by both the widget and the `/usage` command.
 */
export function formatSnapshotLines(snapshots: ProviderSnapshot[], nowMs: number = Date.now()): string[] {
  const nowSec = Math.floor(nowMs / 1000);
  const labelWidth = Math.max(0, ...snapshots.map((s) => s.displayName.length)) + 1;
  const lines: string[] = [];

  for (const snapshot of snapshots) {
    const label = padLabel(snapshot.displayName, labelWidth);

    if (snapshot.status !== "ok") {
      lines.push(`${label}unavailable${snapshot.reason ? ` (${snapshot.reason})` : ""}`);
      continue;
    }

    const windowParts = snapshot.windows.map((w) => {
      const pct = w.usedPercent !== undefined ? Math.round(w.usedPercent) : undefined;
      if (pct === undefined) return `${w.label}: n/a`;
      return `${renderBar(pct)} ${pct}% ${w.label}${formatCountdown(w.resetsAtSec, nowSec)}`;
    });
    const metricParts = snapshot.metrics.map((m) => `${m.value} ${m.label}`);

    const rest = [...windowParts, ...metricParts].join("  ");
    lines.push(rest ? `${label}${rest}` : `${label}(no data)`);
  }

  return lines;
}
