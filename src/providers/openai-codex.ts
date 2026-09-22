// OpenAI Codex (ChatGPT subscription) — active poll.
// Endpoint contract verified against @narumitw/pi-usage (already installed on this
// machine) src/query.ts + src/providers/codex.ts: simple Bearer GET, JSON body with
// rate_limit.primary_window / secondary_window, each { used_percent, reset_at, limit_window_seconds }.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveBearerToken } from "../auth.js";
import { fetchAuthedJson } from "../fetch-json.js";
import type { ProviderSnapshot, UsageWindow } from "../types.js";

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

interface RateWindow {
  used_percent?: number;
  reset_at?: number;
  limit_window_seconds?: number;
}
interface CodexPayload {
  rate_limit?: { primary_window?: RateWindow; secondary_window?: RateWindow };
  plan_type?: string;
}

function toWindow(label: string, raw: RateWindow | undefined): UsageWindow | undefined {
  if (!raw || typeof raw.used_percent !== "number") return undefined;
  return {
    label,
    usedPercent: Math.max(0, Math.min(100, raw.used_percent)),
    ...(typeof raw.reset_at === "number" ? { resetsAtSec: raw.reset_at } : {}),
  };
}

export async function fetchOpenaiCodexSnapshot(ctx: ExtensionContext): Promise<ProviderSnapshot> {
  const base = { providerId: "openai-codex" as const, displayName: "Codex", capturedAt: Date.now() };
  const token = await resolveBearerToken(ctx, "openai-codex");
  if (!token) {
    return { ...base, status: "unavailable", reason: "no active ChatGPT credential", windows: [], metrics: [] };
  }
  try {
    const payload = (await fetchAuthedJson(CODEX_USAGE_URL, token)) as CodexPayload;
    const windows = [
      toWindow("5h", payload.rate_limit?.primary_window),
      toWindow("7d", payload.rate_limit?.secondary_window),
    ].filter((w): w is UsageWindow => w !== undefined);
    const metrics = payload.plan_type ? [{ label: "Plan", value: payload.plan_type }] : [];
    if (windows.length === 0 && metrics.length === 0) {
      return { ...base, status: "unavailable", reason: "no usage data in response", windows: [], metrics: [] };
    }
    return { ...base, status: "ok", windows, metrics };
  } catch (err) {
    return { ...base, status: "unavailable", reason: err instanceof Error ? err.message : String(err), windows: [], metrics: [] };
  }
}
