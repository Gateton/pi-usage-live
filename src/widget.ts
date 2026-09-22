// Shared bar rendering. Kept separate from card.ts so both the colored HUD card
// and any future plain-text output (RPC, logs) render identical bars.

const BAR_WIDTH = 15;

export function renderBar(percent: number): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * BAR_WIDTH);
  return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
}
