// Active-poll orchestration for openai-codex / opencode-go / openrouter.
// Self-scheduling refresh (setTimeout recursion, not setInterval) so a slow or
// failing provider can't cause overlapping requests: normal cadence is 5 minutes,
// but any *real* failure (not just "not configured") backs off to a 30s retry —
// same policy @narumitw/pi-usage uses for Z.AI.
//
// Lifecycle safety: a poll in flight when the session ends (shutdown, /new,
// /reload, /resume) must NOT touch its captured ctx afterwards. Pi invalidates a
// ctx on session replacement and *any* property read then throws. Because this
// class owns timers, an escaping throw would become an unhandled rejection and
// take down the whole pi process — so every entry point here is guarded.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { fetchOpenaiCodexSnapshot } from "./providers/openai-codex.js";
import { fetchOpenCodeGoSnapshot } from "./providers/opencode-go.js";
import { fetchOpenRouterSnapshot } from "./providers/openrouter.js";
import type { UsageState } from "./state.js";

const NORMAL_INTERVAL_MS = 5 * 60_000;
const BACKOFF_INTERVAL_MS = 30_000;

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

  /** Force an out-of-band refresh now (used by model_select and /usage refresh). */
  refreshNow(): void {
    if (this.stopped) return;
    this.scheduleNext(0);
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      // A poller must never be able to crash pi: swallow anything that escapes
      // runOnce() rather than letting it surface as an unhandled rejection.
      void this.runOnce().catch(() => {});
    }, delayMs);
  }

  private async runOnce(): Promise<void> {
    // Skip (rather than queue) when a forced refresh arrived mid-flight.
    if (this.stopped || this.running) return;
    this.running = true;
    let hadRealError = false;
    try {
      const ctx = this.getCtx();
      if (!ctx) return;

      const results = await Promise.allSettled([
        fetchOpenaiCodexSnapshot(ctx),
        fetchOpenCodeGoSnapshot(ctx),
        fetchOpenRouterSnapshot(ctx),
      ]);

      // The session may have ended while those requests were in flight. Their
      // results are still worth caching, but `ctx` is now invalid and rendering
      // through it would throw.
      const ctxIsLive = !this.stopped;
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        const snapshot = result.value;
        await this.state.ingest(snapshot);
        if (snapshot.status === "unavailable" && !(snapshot.reason ?? "").startsWith("no active")) {
          hadRealError = true;
        }
      }
      if (ctxIsLive) this.state.render(ctx);
    } finally {
      this.running = false;
      // scheduleNext() is a no-op once stopped, so a dead session can't reschedule.
      this.scheduleNext(hadRealError ? BACKOFF_INTERVAL_MS : NORMAL_INTERVAL_MS);
    }
  }
}
