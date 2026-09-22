// Central in-memory state: merges fresh snapshots from the passive Anthropic listener
// and the active pollers, decides what's actually worth showing, persists to cache,
// and re-renders the widget. One instance per session.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadCache, persistSnapshot } from "./cache.js";
import { formatSnapshotLines } from "./widget.js";
import { ALL_PROVIDER_IDS, type ProviderSnapshot } from "./types.js";

const WIDGET_ID = "subscription-usage";

function isUnconfigured(snapshot: ProviderSnapshot): boolean {
  return snapshot.status === "unavailable" && (snapshot.reason ?? "").startsWith("no active");
}

export class UsageState {
  private current = new Map<ProviderSnapshot["providerId"], ProviderSnapshot>();
  private everSucceeded = new Set<ProviderSnapshot["providerId"]>();
  private visible = true;

  async loadFromDisk(): Promise<void> {
    const cache = await loadCache();
    for (const id of ALL_PROVIDER_IDS) {
      const snap = cache.snapshots[id];
      if (snap) {
        this.current.set(id, snap);
        if (snap.status === "ok") this.everSucceeded.add(id);
      }
    }
  }

  setVisible(v: boolean): void {
    this.visible = v;
  }
  isVisible(): boolean {
    return this.visible;
  }

  /** Ingest one fresh snapshot. Skips providers that were never configured and still aren't. */
  async ingest(snapshot: ProviderSnapshot): Promise<void> {
    if (snapshot.status === "ok") this.everSucceeded.add(snapshot.providerId);
    if (isUnconfigured(snapshot) && !this.everSucceeded.has(snapshot.providerId)) {
      // Never seen this provider succeed and it's still unconfigured — don't clutter the widget.
      return;
    }
    this.current.set(snapshot.providerId, snapshot);
    await persistSnapshot(snapshot);
  }

  snapshots(): ProviderSnapshot[] {
    return ALL_PROVIDER_IDS.map((id) => this.current.get(id)).filter((s): s is ProviderSnapshot => s !== undefined);
  }

  render(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    if (!this.visible) {
      ctx.ui.setWidget(WIDGET_ID, undefined);
      return;
    }
    const snaps = this.snapshots();
    if (snaps.length === 0) {
      ctx.ui.setWidget(WIDGET_ID, undefined);
      return;
    }
    const lines = formatSnapshotLines(snaps);
    ctx.ui.setWidget(WIDGET_ID, lines, { placement: "aboveEditor" });
  }
}
