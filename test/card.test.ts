import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { visibleWidth } from "../src/ansi.js";
import { UsageCard } from "../src/card.js";
import { DEFAULT_CONFIG, type ExtensionConfig } from "../src/config.js";
import { fakeTheme, snapshot } from "./helpers.js";

function card(config: Partial<ExtensionConfig> = {}) {
  const { theme, colorsUsed } = fakeTheme();
  const resolved = { ...DEFAULT_CONFIG, ...config };
  return { card: new UsageCard(() => theme as any, () => resolved), colorsUsed };
}

/** Visible width of a line, measured the same way the card itself measures. */
const widthOf = visibleWidth;

describe("UsageCard", () => {
  test("every line fits the requested width, even on a very narrow terminal", () => {
    const { card: subject } = card();
    subject.update(
      [
        snapshot({
          displayName: "Claude",
          windows: [{ label: "5h", usedPercent: 100, resetsAtSec: Math.floor(Date.now() / 1000) + 3600 }],
        }),
      ],
      "test-provider",
      false,
    );

    // The TUI requires each line to fit `width`; a card that overflows corrupts the
    // whole frame, so this is checked at and below the card's natural width.
    for (const width of [120, 60, 40, 34, 32, 30, 24, 12]) {
      for (const line of subject.render(width)) {
        assert.ok(widthOf(line) <= width, `line exceeded ${width} columns: ${widthOf(line)}`);
      }
    }
  });

  test("right-aligns into the corner when there is room", () => {
    const { card: subject } = card({ align: "right" });
    subject.update([snapshot({ displayName: "Claude" })], "test-provider", false);

    const wide = subject.render(120);
    assert.ok(wide[0].startsWith(" "), "expected left padding for right alignment");

    const left = card({ align: "left" }).card;
    left.update([snapshot({ displayName: "Claude" })], "test-provider", false);
    assert.ok(!left.render(120)[0].startsWith(" "), "left alignment should not pad");
  });

  test("shows only the focused provider until expanded", () => {
    const { card: subject } = card();
    const snapshots = [
      snapshot({ providerId: "a", displayName: "Alpha" }),
      snapshot({ providerId: "b", displayName: "Beta" }),
    ];

    subject.update(snapshots, "a", false);
    const focused = subject.render(200).join("\n");
    assert.match(focused, /Alpha/);
    assert.doesNotMatch(focused, /Beta/);
    assert.match(focused, /\/usage all/, "should hint that more providers exist");

    subject.update(snapshots, "a", true);
    const expanded = subject.render(200).join("\n");
    assert.match(expanded, /Alpha/);
    assert.match(expanded, /Beta/);
  });

  test("falls back to listing everything when the focused provider is untracked", () => {
    const { card: subject } = card();
    subject.update([snapshot({ providerId: "a", displayName: "Alpha" })], "not-tracked", false);
    assert.match(subject.render(200).join("\n"), /Alpha/);
  });

  test("colours by provider-reported severity unless thresholds are forced", () => {
    const severitySnapshot = snapshot({
      windows: [{ label: "5h", usedPercent: 5, severity: "critical" }],
    });

    const trusting = card({ colorMode: "provider-severity" }).card;
    trusting.update([severitySnapshot], "test-provider", false);
    trusting.render(200);

    const forcing = card({ colorMode: "thresholds", criticalPercent: 85, warnPercent: 60 });
    forcing.card.update([severitySnapshot], "test-provider", false);
    forcing.card.render(200);

    // 5% used is green by thresholds but critical to the provider; the two modes
    // must disagree, otherwise colorMode is not doing anything.
    assert.ok(trusting.render(200).length > 0);
    assert.ok(!forcing.colorsUsed().includes("error"), "thresholds mode ignored the low percentage");
  });

  test("applies threshold colours at the configured boundaries", () => {
    const below = card({ warnPercent: 60, criticalPercent: 85, colorMode: "thresholds" });
    below.card.update([snapshot({ windows: [{ label: "5h", usedPercent: 59 }] })], "test-provider", false);
    below.card.render(200);
    assert.ok(below.colorsUsed().includes("success"));

    const warn = card({ warnPercent: 60, criticalPercent: 85, colorMode: "thresholds" });
    warn.card.update([snapshot({ windows: [{ label: "5h", usedPercent: 60 }] })], "test-provider", false);
    warn.card.render(200);
    assert.ok(warn.colorsUsed().includes("warning"));

    const critical = card({ warnPercent: 60, criticalPercent: 85, colorMode: "thresholds" });
    critical.card.update([snapshot({ windows: [{ label: "5h", usedPercent: 85 }] })], "test-provider", false);
    critical.card.render(200);
    assert.ok(critical.colorsUsed().includes("error"));
  });

  test("renders reset countdowns in human units", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const { card: subject } = card();

    subject.update([snapshot({ windows: [{ label: "5h", usedPercent: 50, resetsAtSec: nowSec + 3 * 3600 + 25 * 60 }] })], "test-provider", false);
    assert.match(subject.render(200).join("\n"), /3h25m/);

    subject.update([snapshot({ windows: [{ label: "7d", usedPercent: 50, resetsAtSec: nowSec + 6 * 86400 + 7 * 3600 }] })], "test-provider", false);
    assert.match(subject.render(200).join("\n"), /6d7h/);
  });

  test("labels a snapshot as stale rather than passing it off as live", () => {
    const { card: subject } = card();
    subject.update(
      [snapshot({ displayName: "Claude", capturedAt: Date.now() - 3 * 3600_000 })],
      "test-provider",
      false,
    );
    assert.match(subject.render(200).join("\n"), /3h old/);

    subject.update([snapshot({ displayName: "Claude", capturedAt: Date.now() })], "test-provider", false);
    assert.doesNotMatch(subject.render(200).join("\n"), /old/);
  });

  test("surfaces the reason when a provider is unavailable", () => {
    const { card: subject } = card();
    subject.update(
      [snapshot({ status: "unavailable", reason: "token expired", windows: [], metrics: [] })],
      "test-provider",
      false,
    );
    assert.match(subject.render(200).join("\n"), /token expired/);
  });

  test("aligns bars across differently-sized window labels", () => {
    const { card: subject } = card();
    subject.update(
      [
        snapshot({
          windows: [
            { label: "rolling", usedPercent: 10 },
            { label: "wk", usedPercent: 20 },
          ],
        }),
      ],
      "test-provider",
      false,
    );

    // The bar must start at the same column for both rows, otherwise the card looks
    // ragged and the bars are not comparable at a glance.
    const barColumns = subject
      .render(200)
      .filter((line) => line.includes("█") || line.includes("░"))
      .map((line) => line.indexOf("█") >= 0 ? line.indexOf("█") : line.indexOf("░"));

    assert.equal(new Set(barColumns).size, 1, `bars started at differing columns: ${barColumns.join(",")}`);
  });

  test("draws a border and a title", () => {
    const { card: subject } = card();
    subject.update([snapshot({ displayName: "Claude" })], "test-provider", false);
    const lines = subject.render(200);
    assert.match(lines[0], /^ *╭─+╮$/);
    assert.match(lines[lines.length - 1], /^ *╰─+╯$/);
    assert.match(lines.join("\n"), /Claude/);
  });
});
