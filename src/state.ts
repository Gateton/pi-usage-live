// Central in-memory state: merges fresh snapshots from the passive Anthropic listener
// and the active pollers, decides what's actually worth showing, persists to cache,
// and re-renders the widget. One instance per session.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadCache, persistSnapshot } from "./cache.js";
import { UsageCard, type CardAlign } from "./card.js";
import { ALL_PROVIDER_IDS, type ProviderSnapshot } from "./types.js";

const WIDGET_ID = "subscription-usage";

function isUnconfigured(snapshot: ProviderSnapshot): boolean {
  return snapshot.status === "unavailable" && (snapshot.reason ?? "").startsWith("no active");
}

export class UsageState {
  private current = new Map<ProviderSnapshot["providerId"], ProviderSnapshot>();
  private everSucceeded = new Set<ProviderSnapshot["providerId"]>();
  private visible = true;
  private expanded = false;
  private align: CardAlign = "right";
  private card: UsageCard | undefined;

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
  setExpanded(v: boolean): void {
    this.expanded = v;
  }
  isExpanded(): boolean {
    return this.expanded;
  }
  setAlign(align: CardAlign): void {
    this.align = align;
  }
  getAlign(): CardAlign {
    return this.align;
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
    // Any property read on a ctx invalidated by session replacement/reload throws.
    // Rendering is best-effort UI work, so a dead ctx just means "nothing to draw" —
    // it must never propagate into a caller (or into a timer callback, where it would
    // become an unhandled rejection and kill the process).
    try {
      this.renderUnsafe(ctx);
    } catch {
      // Session ended mid-render; drop it.
    }
  }

  private renderUnsafe(ctx: ExtensionContext): void {
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
    // setWidget caches the component we return and only calls invalidate() on a theme
    // change, so the card reads ctx.ui.theme lazily at render time instead of capturing
    // it once — otherwise it would keep painting with a stale theme after /settings.
    ctx.ui.setWidget(
      WIDGET_ID,
      () => {
        if (!this.card) this.card = new UsageCard(() => ctx.ui.theme);
        this.card.setAlign(this.align);
        this.card.update(snaps, ctx.model?.provider as ProviderSnapshot["providerId"] | undefined, this.expanded);
        return this.card;
      },
      { placement: "aboveEditor" },
    );
  }
}
