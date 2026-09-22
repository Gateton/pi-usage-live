// Active-poll orchestration for openai-codex / opencode-go / openrouter.
// Self-scheduling refresh (setTimeout recursion, not setInterval) so a slow or
// failing provider can't cause overlapping requests: normal cadence is 5 minutes,
// but any *real* failure (not just "not configured") backs off to a 30s retry —
// same policy @narumitw/pi-usage uses for Z.AI.
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

  constructor(
    private readonly state: UsageState,
    private readonly getCtx: () => ExtensionContext | undefined,
  ) {}

  start(): void {
    this.scheduleNext(0);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Force an out-of-band refresh now (used by session_start, model_select, and /usage). */
  refreshNow(): void {
    this.scheduleNext(0);
  }

  private scheduleNext(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.runOnce(), delayMs);
  }

  private async runOnce(): Promise<void> {
    if (this.running) return; // A forced refresh landed while one was already in flight — skip, not queue.
    this.running = true;
    let hadRealError = false;
    try {
      const ctx = this.getCtx();
      if (!ctx) {
        this.scheduleNext(NORMAL_INTERVAL_MS);
        return;
      }
      const results = await Promise.allSettled([
        fetchOpenaiCodexSnapshot(ctx),
        fetchOpenCodeGoSnapshot(ctx),
        fetchOpenRouterSnapshot(ctx),
      ]);
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        const snapshot = result.value;
        await this.state.ingest(snapshot);
        if (snapshot.status === "unavailable" && !(snapshot.reason ?? "").startsWith("no active")) {
          hadRealError = true;
        }
      }
      this.state.render(ctx);
    } finally {
      this.running = false;
      this.scheduleNext(hadRealError ? BACKOFF_INTERVAL_MS : NORMAL_INTERVAL_MS);
    }
  }
}
