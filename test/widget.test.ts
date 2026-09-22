import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderBar } from "../src/widget.js";

describe("renderBar", () => {
  test("is always the same visible width", () => {
    for (const percent of [0, 1, 33, 50, 99, 100]) {
      assert.equal(renderBar(percent).length, 15, `width at ${percent}%`);
    }
  });

  test("empty at 0 and full at 100", () => {
    assert.equal(renderBar(0), "░".repeat(15));
    assert.equal(renderBar(100), "█".repeat(15));
  });

  test("clamps out-of-range values instead of emitting a wrong width", () => {
    // A provider should never report these, but a bad payload must not break layout.
    assert.equal(renderBar(-10), renderBar(0));
    assert.equal(renderBar(150), renderBar(100));
    assert.equal(renderBar(Number.NaN).length, 15);
  });

  test("is monotonic", () => {
    let previous = -1;
    for (let percent = 0; percent <= 100; percent++) {
      const filled = (renderBar(percent).match(/█/g) ?? []).length;
      assert.ok(filled >= previous, `filled cell count went backwards at ${percent}%`);
      previous = filled;
    }
  });
});
