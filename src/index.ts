// pi-subscription-usage — jcode-style always-on subscription usage widget.
//
// Claude (anthropic) is updated passively from after_provider_response headers
// (zero extra network calls). OpenAI Codex, OpenCode Go, and OpenRouter are
// polled actively every 5 minutes (backing off to 30s on real errors) via Pi's
// documented ctx.modelRegistry.getProviderAuth() credential resolution.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseAnthropicHeaders } from "./providers/anthropic.js";
import { ActivePoller } from "./poller.js";
import { UsageState } from "./state.js";

export default function (pi: ExtensionAPI) {
  const state = new UsageState();
  let latestCtx: ExtensionContext | undefined;
  const poller = new ActivePoller(state, () => latestCtx);

  pi.on("session_start", async (_event, ctx) => {
    latestCtx = ctx;
    await state.loadFromDisk();
    state.render(ctx);
    poller.start();
  });

  pi.on("session_shutdown", async () => {
    poller.stop();
  });

  // Passive Claude update: parse rate-limit headers from every real Anthropic response.
  pi.on("after_provider_response", async (event, ctx) => {
    latestCtx = ctx;
    if (ctx.model?.provider !== "anthropic") return;
    const snapshot = parseAnthropicHeaders(event.headers as Record<string, string> | undefined);
    if (!snapshot) return;
    await state.ingest(snapshot);
    state.render(ctx);
  });

  // Switching models is the moment a stale Codex/OpenCode Go/OpenRouter row is most
  // likely to be wrong, and it's also what decides which provider the compact card
  // focuses on — re-render immediately from cache, then refresh in the background.
  pi.on("model_select", async (_event, ctx) => {
    latestCtx = ctx;
    state.render(ctx);
    poller.refreshNow();
  });

  pi.registerCommand("usage", {
    description: "Toggle the live subscription usage widget, expand to all providers, or force a refresh",
    handler: async (args, ctx) => {
      latestCtx = ctx;
      const arg = (args ?? "").trim().toLowerCase();
      if (arg === "hide") {
        state.setVisible(false);
        state.render(ctx);
        return;
      }
      if (arg === "show") {
        state.setVisible(true);
        state.render(ctx);
        return;
      }
      if (arg === "all" || arg === "expand") {
        state.setVisible(true);
        state.setExpanded(true);
        state.render(ctx);
        return;
      }
      if (arg === "compact" || arg === "collapse") {
        state.setVisible(true);
        state.setExpanded(false);
        state.render(ctx);
        return;
      }
      if (arg === "align") {
        const next = state.getAlign() === "right" ? "left" : "right";
        state.setAlign(next);
        state.render(ctx);
        ctx.ui.notify(`Usage widget aligned ${next}`, "info");
        return;
      }
      if (arg === "align left" || arg === "align right") {
        const next = arg.endsWith("left") ? "left" : "right";
        state.setAlign(next);
        state.render(ctx);
        return;
      }
      if (arg === "refresh") {
        poller.refreshNow();
        ctx.ui.notify("Refreshing subscription usage...", "info");
        return;
      }
      // No args: toggle visibility (most common case bound to muscle memory from /usage).
      state.setVisible(!state.isVisible());
      state.render(ctx);
      if (!state.isVisible()) return;
      poller.refreshNow();
    },
  });
}
