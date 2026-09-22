// In-memory usage state: merges snapshots from the passive listener and the
// pollers, decides what is worth showing, persists to cache, and redraws the card.
// Knows nothing about any specific provider.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadCache, persistSnapshot } from "./cache.js";
import { UsageCard } from "./card.js";
import type { ExtensionConfig } from "./config.js";
import type { ProviderSnapshot } from "./types.js";

export const WIDGET_ID = "subscription-usage";

export class UsageState {
  private snapshots = new Map<string, ProviderSnapshot>();
  private everConfigured = new Set<string>();
  private card: UsageCard | undefined;
  /** When true the card lists every provider instead of only the focused one. */
  private expandedAll = false;

  constructor(
    private readonly agentDir: string,
    private config: ExtensionConfig,
  ) {}

  getConfig(): ExtensionConfig {
    return this.config;
  }

  setConfig(config: ExtensionConfig): void {
    this.config = config;
  }

  setExpandedAll(value: boolean): void {
    this.expandedAll = value;
  }

  isExpandedAll(): boolean {
    return this.expandedAll;
  }

  async loadFromDisk(): Promise<void> {
    const cache = await loadCache(this.agentDir);
    for (const [id, snapshot] of Object.entries(cache.snapshots)) {
      this.snapshots.set(id, snapshot);
      if (snapshot.configured) this.everConfigured.add(id);
    }
  }

  /**
   * Ingest a fresh snapshot.
   *
   * A provider the user has never had a credential for is dropped rather than
   * displayed, so an unconfigured provider never adds a permanent "unavailable"
   * row to the card.
   */
  async ingest(snapshot: ProviderSnapshot): Promise<void> {
    if (snapshot.configured) this.everConfigured.add(snapshot.providerId);
    if (!snapshot.configured && !this.everConfigured.has(snapshot.providerId)) return;

    this.snapshots.set(snapshot.providerId, snapshot);
    await persistSnapshot(this.agentDir, snapshot);
  }

  /** Snapshots after applying the user's enable/disable lists. */
  visibleSnapshots(): ProviderSnapshot[] {
    const { enabledProviders, disabledProviders } = this.config;
    const allow = new Set(enabledProviders);
    const deny = new Set(disabledProviders);

    return [...this.snapshots.values()]
      .filter((snapshot) => !deny.has(snapshot.providerId))
      .filter((snapshot) => allow.size === 0 || allow.has(snapshot.providerId))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  render(ctx: ExtensionContext): void {
    // Any property read on a ctx invalidated by session replacement or reload
    // throws. Drawing is best-effort, so a dead ctx just means "nothing to draw" —
    // it must never propagate into a caller, where from a timer callback it would
    // become an unhandled rejection and kill the pi process.
    try {
      this.renderUnsafe(ctx);
    } catch {
      // Session ended mid-render.
    }
  }

  private renderUnsafe(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;

    const snapshots = this.visibleSnapshots();
    if (!this.config.visible || snapshots.length === 0) {
      ctx.ui.setWidget(WIDGET_ID, undefined);
      return;
    }

    // setWidget caches the component we return and only calls invalidate() on a
    // theme change, so the card reads ctx.ui.theme lazily while rendering instead
    // of capturing it once — otherwise it would keep painting a stale theme.
    ctx.ui.setWidget(
      WIDGET_ID,
      () => {
        if (!this.card) this.card = new UsageCard(() => ctx.ui.theme, () => this.config);
        this.card.update(snapshots, ctx.model?.provider, this.expandedAll);
        return this.card;
      },
      { placement: "aboveEditor" },
    );
  }
}
