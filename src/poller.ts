// Active polling across every adapter that exposes a usage endpoint.
//
// Self-scheduling (setTimeout recursion rather than setInterval) so a slow provider
// cannot cause overlapping requests: the cadence comes from config, and any real
// failure backs off to a short retry.
//
// Lifecycle safety: a poll in flight when the session ends (shutdown, /new,
// /reload, /resume) must never touch its captured ctx afterwards. Pi invalidates a
// ctx on session replacement and *any* property read then throws. Because this class
// owns timers, an escaping throw would become an unhandled rejection and take down
// the whole pi process, so every entry point here is guarded.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveCredential } from "./auth.js";
import { getAdapter, pollableAdapters } from "./providers/index.js";
import type { UsageState } from "./state.js";
import type { ProviderSnapshot } from "./types.js";

const BACKOFF_INTERVAL_MS = 30_000;
/** Never let a single provider's request outlive this, whatever the poll interval. */
const MAX_QUERY_MS = 10_000;

export class ActivePoller {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  /** True when no session is active; blocks scheduling and abandons in-flight results. */
  private stopped = true;

  constructor(
    private readonly state: UsageState,
    private readonly getCtx: () => ExtensionContext | undefined,
  ) {}

  start(): void {
    this.stopped = false;
    this.scheduleNext(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Force an out-of-band refresh now (model_select, /usage refresh). */
  refreshNow(): void {
    if (this.stopped) return;
    this.scheduleNext(0);
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      // A usage poller must never be able to crash pi: swallow whatever escapes
      // runOnce() rather than letting it become an unhandled rejection.
      void this.runOnce().catch(() => {});
    }, delayMs);
  }

  private async runOnce(): Promise<void> {
    // Skip (do not queue) when a forced refresh arrived while one was in flight.
    if (this.stopped || this.running) return;
    this.running = true;

    const intervalMs = this.state.getConfig().pollIntervalSec * 1000;
    let hadRealError = false;

    try {
      const ctx = this.getCtx();
      if (!ctx) return;

      const results = await Promise.allSettled(
        pollableAdapters().map((adapter) => this.pollOne(ctx, adapter.id)),
      );

      // The session may have ended while those requests were in flight. Their
      // results are still worth caching, but `ctx` is now invalid and rendering
      // through it would throw.
      const ctxIsLive = !this.stopped;

      for (const result of results) {
        if (result.status !== "fulfilled" || result.value === undefined) {
          hadRealError = true;
          continue;
        }
        const snapshot = result.value;
        await this.state.ingest(snapshot);
        if (snapshot.status === "unavailable" && snapshot.configured) hadRealError = true;
      }

      if (ctxIsLive) this.state.render(ctx);
    } finally {
      this.running = false;
      // A no-op once stopped, so a dead session cannot reschedule itself.
      this.scheduleNext(hadRealError ? BACKOFF_INTERVAL_MS : intervalMs);
    }
  }

  /** Poll one adapter. Never throws: any failure becomes an unavailable snapshot. */
  private async pollOne(ctx: ExtensionContext, providerId: string): Promise<ProviderSnapshot | undefined> {
    const adapter = getAdapter(providerId);
    if (!adapter?.query) return undefined;

    const base = { providerId: adapter.id, displayName: adapter.displayName, capturedAt: Date.now() };

    let outcome;
    try {
      outcome = await resolveCredential(ctx, adapter);
    } catch (error) {
      return unavailable(base, true, errorMessage(error));
    }

    if (!outcome.ok) return unavailable(base, outcome.configured, outcome.reason);

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Math.min(this.state.getConfig().pollIntervalSec * 1000, MAX_QUERY_MS),
    );
    try {
      const result = await adapter.query(outcome.credential, {
        signal: controller.signal,
        target: this.state.getConfig().targets[adapter.id],
      });
      if (result.status === "unavailable") return unavailable(base, result.configured, result.reason);
      return { ...base, status: "ok", configured: true, windows: result.windows, metrics: result.metrics };
    } catch (error) {
      return unavailable(base, true, errorMessage(error));
    } finally {
      clearTimeout(timeout);
    }
  }
}

interface SnapshotBase {
  providerId: string;
  displayName: string;
  capturedAt: number;
}

function unavailable(base: SnapshotBase, configured: boolean, reason: string): ProviderSnapshot {
  return { ...base, status: "unavailable", configured, reason, windows: [], metrics: [] };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
