import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { CACHE_FILE_NAME, cachePath, loadCache, persistSnapshot } from "../src/cache.js";
import { snapshot } from "./helpers.js";

let dir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "psu-cache-"));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("cache", () => {
  test("an absent file yields an empty cache rather than an error", async () => {
    const cache = await loadCache(join(dir, "does-not-exist"));
    assert.deepEqual(cache.snapshots, {});
  });

  test("round-trips a snapshot", async () => {
    const target = await mkdtemp(join(dir, "round-trip-"));
    const entry = snapshot({ providerId: "alpha", displayName: "Alpha", windows: [{ label: "5h", usedPercent: 42 }] });

    await persistSnapshot(target, entry);
    const { snapshots } = await loadCache(target);

    assert.equal(snapshots.alpha?.displayName, "Alpha");
    assert.equal(snapshots.alpha?.windows[0]?.usedPercent, 42);
  });

  test("persisting twice keeps both providers", async () => {
    const target = await mkdtemp(join(dir, "merge-"));
    await persistSnapshot(target, snapshot({ providerId: "alpha" }));
    await persistSnapshot(target, snapshot({ providerId: "beta" }));

    const { snapshots } = await loadCache(target);
    assert.deepEqual(Object.keys(snapshots).sort(), ["alpha", "beta"]);
  });

  test("discards a cache written by an incompatible version", async () => {
    const target = await mkdtemp(join(dir, "version-"));
    // v1 predates the explicit `configured` field, so rendering it would be wrong.
    await writeFile(
      cachePath(target),
      JSON.stringify({ version: 1, snapshots: { alpha: snapshot({ providerId: "alpha" }) } }),
      "utf8",
    );
    assert.deepEqual((await loadCache(target)).snapshots, {});
  });

  test("survives corrupt JSON instead of throwing", async () => {
    const target = await mkdtemp(join(dir, "corrupt-"));
    await writeFile(cachePath(target), "{ not json at all", "utf8");
    assert.deepEqual((await loadCache(target)).snapshots, {});
  });

  test("drops entries that do not look like snapshots", async () => {
    const target = await mkdtemp(join(dir, "shape-"));
    await writeFile(
      cachePath(target),
      JSON.stringify({
        version: 2,
        snapshots: { good: snapshot({ providerId: "good" }), bad: { providerId: "bad" } },
      }),
      "utf8",
    );

    const { snapshots } = await loadCache(target);
    assert.deepEqual(Object.keys(snapshots), ["good"]);
  });

  test("leaves no temporary files behind", async () => {
    const target = await mkdtemp(join(dir, "tempfiles-"));
    await persistSnapshot(target, snapshot({ providerId: "alpha" }));
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(target);
    assert.deepEqual(entries, [CACHE_FILE_NAME]);
  });

  test("writes readable, indented JSON", async () => {
    const target = await mkdtemp(join(dir, "format-"));
    await persistSnapshot(target, snapshot({ providerId: "alpha" }));
    const raw = await readFile(cachePath(target), "utf8");
    assert.match(raw, /\n {2}"snapshots"/);
  });
});
