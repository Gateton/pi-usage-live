import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { DEFAULT_CONFIG, configPath, loadConfig, normalizeConfig, saveConfig } from "../src/config.js";

let dir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "psu-config-"));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("normalizeConfig", () => {
  test("an empty or non-object input yields defaults", () => {
    assert.deepEqual(normalizeConfig({}), DEFAULT_CONFIG);
    assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
    assert.deepEqual(normalizeConfig("nonsense"), DEFAULT_CONFIG);
    assert.deepEqual(normalizeConfig([]), DEFAULT_CONFIG);
  });

  test("keeps valid values", () => {
    const config = normalizeConfig({
      align: "left",
      visible: false,
      pollIntervalSec: 600,
      warnPercent: 50,
      criticalPercent: 90,
      colorMode: "thresholds",
    });
    assert.equal(config.align, "left");
    assert.equal(config.visible, false);
    assert.equal(config.pollIntervalSec, 600);
    assert.equal(config.warnPercent, 50);
    assert.equal(config.criticalPercent, 90);
    assert.equal(config.colorMode, "thresholds");
  });

  test("rejects unknown enum values instead of trusting them", () => {
    assert.equal(normalizeConfig({ align: "diagonal" }).align, DEFAULT_CONFIG.align);
    assert.equal(normalizeConfig({ colorMode: "rainbow" }).colorMode, DEFAULT_CONFIG.colorMode);
  });

  test("floors the poll interval so a user cannot hammer a provider", () => {
    // Polling a quota endpoint every second would get the user rate-limited by the
    // very provider they are trying to monitor.
    assert.equal(normalizeConfig({ pollIntervalSec: 1 }).pollIntervalSec, 30);
    assert.equal(normalizeConfig({ pollIntervalSec: 0 }).pollIntervalSec, DEFAULT_CONFIG.pollIntervalSec);
    assert.equal(normalizeConfig({ pollIntervalSec: -60 }).pollIntervalSec, DEFAULT_CONFIG.pollIntervalSec);
    assert.equal(normalizeConfig({ pollIntervalSec: "abc" }).pollIntervalSec, DEFAULT_CONFIG.pollIntervalSec);
  });

  test("keeps the warn/critical thresholds ordered", () => {
    // A red threshold below the yellow one would make the palette nonsensical.
    const inverted = normalizeConfig({ warnPercent: 90, criticalPercent: 20 });
    assert.ok(inverted.warnPercent <= inverted.criticalPercent);
    assert.equal(inverted.warnPercent, 20);
    assert.equal(inverted.criticalPercent, 90);
  });

  test("clamps percentages into range", () => {
    assert.equal(normalizeConfig({ criticalPercent: 500 }).criticalPercent, 100);
    assert.equal(normalizeConfig({ warnPercent: -50 }).warnPercent, 0);
  });

  test("keeps provider lists only when they are clean string arrays", () => {
    assert.deepEqual(normalizeConfig({ enabledProviders: ["a", "b"] }).enabledProviders, ["a", "b"]);
    assert.deepEqual(normalizeConfig({ enabledProviders: [1, 2] }).enabledProviders, DEFAULT_CONFIG.enabledProviders);
    assert.deepEqual(normalizeConfig({ enabledProviders: "a" }).enabledProviders, DEFAULT_CONFIG.enabledProviders);
  });

  test("keeps only string target selections", () => {
    assert.deepEqual(normalizeConfig({ targets: { fireworks: "acct", bad: 5 } }).targets, { fireworks: "acct" });
    assert.deepEqual(normalizeConfig({ targets: [] }).targets, DEFAULT_CONFIG.targets);
  });
});

describe("loading and saving", () => {
  test("a missing file loads defaults", async () => {
    assert.deepEqual(await loadConfig(join(dir, "absent")), DEFAULT_CONFIG);
  });

  test("a corrupt file loads defaults rather than failing", async () => {
    const target = await mkdtemp(join(dir, "corrupt-"));
    await writeFile(configPath(target), "{ broken", "utf8");
    assert.deepEqual(await loadConfig(target), DEFAULT_CONFIG);
  });

  test("round-trips a change", async () => {
    const target = await mkdtemp(join(dir, "round-"));
    await saveConfig(target, { ...DEFAULT_CONFIG, align: "left", pollIntervalSec: 120 });
    const loaded = await loadConfig(target);
    assert.equal(loaded.align, "left");
    assert.equal(loaded.pollIntervalSec, 120);
  });

  test("preserves keys written by a newer version", async () => {
    const target = await mkdtemp(join(dir, "forward-"));
    await writeFile(configPath(target), JSON.stringify({ futureSetting: "keep me" }), "utf8");

    await saveConfig(target, { ...DEFAULT_CONFIG, align: "left" });
    const raw = JSON.parse(await readFile(configPath(target), "utf8"));
    assert.equal(raw.futureSetting, "keep me", "an unknown key was silently discarded");
    assert.equal(raw.align, "left");
  });

  test("loads a partial file by filling in defaults", async () => {
    const target = await mkdtemp(join(dir, "partial-"));
    await writeFile(configPath(target), JSON.stringify({ align: "left" }), "utf8");
    const loaded = await loadConfig(target);
    assert.equal(loaded.align, "left");
    assert.equal(loaded.pollIntervalSec, DEFAULT_CONFIG.pollIntervalSec);
  });
});
