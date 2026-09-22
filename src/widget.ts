// Shared bar rendering. Kept separate from card.ts so both the coloured HUD card
// and any future plain-text output (RPC, logs) draw identical bars.

const BAR_WIDTH = 15;

/**
 * A fixed-width bar for a 0-100 percentage.
 *
 * Non-finite input yields an empty bar rather than an empty string: a provider that
 * reports a null or NaN percentage must not collapse the card's layout, and
 * `"█".repeat(NaN)` producing "" would do exactly that.
 */
export function renderBar(percent: number): string {
  const safe = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  const filled = Math.round((safe / 100) * BAR_WIDTH);
  return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
}
