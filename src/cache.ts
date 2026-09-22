// Reads/writes the last-known usage snapshot so the widget never starts blank after a restart.
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ProviderSnapshot, UsageCacheFile } from "./types.js";

const CACHE_FILE_NAME = "subscription-usage.json";

function cachePath(): string {
  return join(getAgentDir(), CACHE_FILE_NAME);
}

export async function loadCache(): Promise<UsageCacheFile> {
  try {
    const raw = await readFile(cachePath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as UsageCacheFile).version === 1 &&
      typeof (parsed as UsageCacheFile).snapshots === "object"
    ) {
      return parsed as UsageCacheFile;
    }
  } catch {
    // Missing or corrupt cache is not fatal — start empty.
  }
  return { version: 1, snapshots: {} };
}

/** Merge one fresh snapshot into the on-disk cache (write-through, atomic rename). */
export async function persistSnapshot(snapshot: ProviderSnapshot): Promise<void> {
  const current = await loadCache();
  current.snapshots[snapshot.providerId] = snapshot;
  const path = cachePath();
  const tmp = join(getAgentDir(), `.${CACHE_FILE_NAME}.${randomUUID()}.tmp`);
  try {
    await writeFile(tmp, JSON.stringify(current, null, 2), "utf8");
    await rename(tmp, path);
  } catch {
    // Best-effort cache; a failed write should never break the widget or the turn.
  }
}
