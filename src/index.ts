// pi-subscription-usage — an always-on subscription usage card for pi.
//
// Providers are discovered from the registry (src/providers/); nothing in this file
// names one. Each provider contributes either passive capture (parsing quota out of
// real inference response headers, which costs nothing) or an active query against
// its documented usage endpoint, or both.
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG, loadConfig, saveConfig, type ExtensionConfig } from "./config.js";
import { ActivePoller } from "./poller.js";
import { getAdapter } from "./providers/index.js";
import { UsageState } from "./state.js";
import type { ProviderSnapshot } from "./types.js";

export default function (pi: ExtensionAPI) {
  const agentDir = getAgentDir();
  const state = new UsageState(agentDir, { ...DEFAULT_CONFIG });
  const poller = new ActivePoller(state, () => latestCtx);
  let latestCtx: ExtensionContext | undefined;

  pi.on("session_start", async (_event, ctx) => {
    latestCtx = ctx;
    state.setConfig(await loadConfig(agentDir));
    await state.loadFromDisk();
    state.render(ctx);
    // Only poll when there is a UI to draw into. Headless runs (-p, --mode json) are
    // short-lived, gain nothing from a poll, and their session dies mid-request.
    if (ctx.hasUI) poller.start();
  });

  pi.on("session_shutdown", async () => {
    // Drop the ctx first: anything reading it after this must no-op rather than
    // touch an invalidated context.
    latestCtx = undefined;
    poller.stop();
  });

  // Passive capture: whichever provider just answered may expose quota in its own
  // response headers. Costs no extra request.
  pi.on("after_provider_response", async (event, ctx) => {
    latestCtx = ctx;
    const adapter = getAdapter(ctx.model?.provider);
    if (!adapter?.fromResponseHeaders) return;

    const result = adapter.fromResponseHeaders(event.headers as Record<string, string> | undefined);
    if (!result) return;

    const base = { providerId: adapter.id, displayName: adapter.displayName, capturedAt: Date.now() };
    const snapshot: ProviderSnapshot =
      result.status === "ok"
        ? { ...base, status: "ok", configured: true, windows: result.windows, metrics: result.metrics }
        : {
            ...base,
            status: "unavailable",
            configured: result.configured,
            reason: result.reason,
            windows: [],
            metrics: [],
          };

    await state.ingest(snapshot);
    state.render(ctx);
  });

  // Switching models changes which provider the card focuses, and is exactly when a
  // cached row for another provider is most likely to be stale.
  pi.on("model_select", async (_event, ctx) => {
    latestCtx = ctx;
    state.render(ctx);
    poller.refreshNow();
  });

  pi.registerCommand("usage", {
    description: "Toggle the subscription usage card, expand to all providers, or refresh",
    handler: async (args, ctx) => {
      latestCtx = ctx;
      const arg = (args ?? "").trim().toLowerCase();

      const apply = async (patch: Partial<ExtensionConfig>): Promise<void> => {
        const next = { ...state.getConfig(), ...patch };
        state.setConfig(next);
        await saveConfig(agentDir, next);
        state.render(ctx);
      };

      switch (arg) {
        case "all":
        case "expand":
          state.setExpandedAll(true);
          await apply({ visible: true });
          return;

        case "compact":
        case "collapse":
          state.setExpandedAll(false);
          state.render(ctx);
          return;

        case "show":
        case "hide":
          await apply({ visible: arg === "show" });
          if (state.getConfig().visible) poller.refreshNow();
          return;

        case "align":
          await apply({ align: state.getConfig().align === "right" ? "left" : "right" });
          ctx.ui.notify(`Usage card aligned ${state.getConfig().align}`, "info");
          return;

        case "refresh":
          poller.refreshNow();
          ctx.ui.notify("Refreshing subscription usage...", "info");
          return;

        case "reload":
          state.setConfig(await loadConfig(agentDir));
          state.render(ctx);
          ctx.ui.notify("Reloaded usage config", "info");
          return;

        default: {
          const next = !state.getConfig().visible;
          await apply({ visible: next });
          if (next) poller.refreshNow();
          return;
        }
      }
    },
  });
}
