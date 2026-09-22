// Last-known snapshot per provider, so the widget shows real data immediately on
// startup instead of an empty card until the first poll lands.
//
// The directory is injected rather than read from pi's globals so this module is
// testable without a pi process.
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ProviderSnapshot } from "./types.js";

export const CACHE_FILE_NAME = "subscription-usage.json";
/**
 * Bumped whenever ProviderSnapshot's shape changes, so a cache written by an older
 * version is discarded instead of being rendered as half-valid data.
 * v2: added the explicit `configured` field.
 */
const CACHE_VERSION = 2;

export interface UsageCache {
  version: number;
  snapshots: Record<string, ProviderSnapshot>;
}

function emptyCache(): UsageCache {
  return { version: CACHE_VERSION, snapshots: {} };
}

function isSnapshot(value: unknown): value is ProviderSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ProviderSnapshot>;
  return (
    typeof candidate.providerId === "string" &&
    typeof candidate.displayName === "string" &&
    (candidate.status === "ok" || candidate.status === "unavailable") &&
    typeof candidate.capturedAt === "number" &&
    Array.isArray(candidate.windows) &&
    Array.isArray(candidate.metrics)
  );
}

export function cachePath(agentDir: string): string {
  return join(agentDir, CACHE_FILE_NAME);
}

/**
 * Read the cache. Anything unexpected yields an empty cache: a stale or corrupt
 * file must never prevent the widget from starting.
 */
export async function loadCache(agentDir: string, now = Date.now()): Promise<UsageCache> {
  try {
    const parsed = JSON.parse(await readFile(cachePath(agentDir), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return emptyCache();

    const record = parsed as Partial<UsageCache>;
    if (record.version !== CACHE_VERSION || !record.snapshots) return emptyCache();

    const snapshots: Record<string, ProviderSnapshot> = {};
    for (const [id, snapshot] of Object.entries(record.snapshots)) {
      // Drop entries from an older shape rather than rendering half-read data.
      if (isSnapshot(snapshot)) snapshots[id] = { ...snapshot, capturedAt: snapshot.capturedAt || now };
    }
    return { version: CACHE_VERSION, snapshots };
  } catch {
    return emptyCache();
  }
}

/** Write one snapshot into the cache atomically. Best-effort. */
export async function persistSnapshot(agentDir: string, snapshot: ProviderSnapshot): Promise<void> {
  const cache = await loadCache(agentDir);
  cache.snapshots[snapshot.providerId] = snapshot;
  await persistCache(agentDir, cache);
}

export async function persistCache(agentDir: string, cache: UsageCache): Promise<void> {
  const temporary = join(agentDir, `.${CACHE_FILE_NAME}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
    await rename(temporary, cachePath(agentDir));
  } catch {
    // Best-effort: a failed cache write must never break a turn.
  }
}
