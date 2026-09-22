import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fitToWidth, truncateToWidth, visibleWidth } from "../src/ansi.js";

const red = (text: string) => `\x1b[31m${text}\x1b[0m`;

describe("visibleWidth", () => {
  test("ignores escape sequences", () => {
    assert.equal(visibleWidth("abc"), 3);
    assert.equal(visibleWidth(red("abc")), 3);
    assert.equal(visibleWidth(`${red("a")}b${red("c")}`), 3);
  });

  test("counts block and box-drawing characters as one column each", () => {
    assert.equal(visibleWidth("█░"), 2);
    assert.equal(visibleWidth("╭─╮"), 3);
  });

  test("is empty for an empty string", () => {
    assert.equal(visibleWidth(""), 0);
  });
});

describe("truncateToWidth", () => {
  test("leaves short text untouched", () => {
    assert.equal(truncateToWidth("abc", 10), "abc");
    assert.equal(truncateToWidth("abc", 3), "abc");
  });

  test("cuts long text to fit, including the ellipsis", () => {
    const result = truncateToWidth("abcdefghij", 5);
    assert.equal(visibleWidth(result), 5);
    assert.ok(result.endsWith("…"));
  });

  test("never exceeds the requested width", () => {
    for (const width of [1, 2, 3, 7, 14]) {
      for (const text of ["a", "abcdefghijklmno", red("abcdefghijklmno"), "████████████"]) {
        assert.ok(visibleWidth(truncateToWidth(text, width)) <= width, `width ${width} on ${text}`);
      }
    }
  });

  test("keeps styling on the surviving prefix", () => {
    const result = truncateToWidth(red("abcdefghij"), 5);
    assert.ok(result.includes("\x1b[31m"), "colour prefix should survive truncation");
    assert.equal(visibleWidth(result), 5);
  });

  test("returns empty for non-positive widths", () => {
    assert.equal(truncateToWidth("abc", 0), "");
    assert.equal(truncateToWidth("abc", -5), "");
  });
});

describe("fitToWidth", () => {
  test("pads short text to exactly the width", () => {
    assert.equal(fitToWidth("abc", 6), "abc   ");
    assert.equal(visibleWidth(fitToWidth("abc", 6)), 6);
  });

  test("truncates long text to exactly the width", () => {
    assert.equal(visibleWidth(fitToWidth("abcdefghijklmnop", 8)), 8);
  });

  test("is idempotent and always yields the requested width", () => {
    for (const width of [1, 5, 20, 40]) {
      for (const text of ["", "a", "abcdefghijklmnopqrstuvwxyz", red("styled text here")]) {
        const once = fitToWidth(text, width);
        assert.equal(visibleWidth(once), width, `width ${width} for ${JSON.stringify(text)}`);
        assert.equal(fitToWidth(once, width), once, "should be stable when re-applied");
      }
    }
  });
});
