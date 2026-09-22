// OpenAI Codex (ChatGPT consumer subscription).
//
// Endpoint contract cross-checked against @narumitw/pi-usage (MIT) before it was
// uninstalled: a Bearer GET returning
//   rate_limit.{primary_window,secondary_window}.{used_percent, reset_at, limit_window_seconds}
// where used_percent is already 0..100.
import type { AdapterResult, ProviderAdapter, UsageWindow } from "../types.js";
import { asNumber, asObject, asString, clampPercent, fetchJson } from "../fetch-json.js";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

function toWindow(label: string, raw: unknown): UsageWindow | undefined {
  const window = asObject(raw);
  if (!window) return undefined;
  const used = asNumber(window.used_percent);
  if (used === undefined) return undefined;
  const resetsAt = asNumber(window.reset_at);
  return {
    label,
    usedPercent: clampPercent(used),
    ...(resetsAt !== undefined ? { resetsAtSec: resetsAt } : {}),
  };
}

export const openaiCodexAdapter: ProviderAdapter = {
  id: "openai-codex",
  displayName: "Codex",
  officialOrigins: ["https://chatgpt.com"],
  authStyle: "bearer",

  async query(credential, ctx): Promise<AdapterResult> {
    const payload = asObject(
      await fetchJson(USAGE_URL, {
        headers: credential.headers,
        secrets: credential.secrets,
        signal: ctx.signal,
        label: "Codex usage endpoint",
      }),
    );
    if (!payload) return { status: "unavailable", configured: true, reason: "malformed response" };

    const rateLimit = asObject(payload.rate_limit);
    const windows = [
      toWindow("5h", rateLimit?.primary_window),
      toWindow("7d", rateLimit?.secondary_window),
    ].filter((window): window is UsageWindow => window !== undefined);

    const plan = asString(payload.plan_type);
    const metrics = plan ? [{ label: "Plan", value: plan }] : [];

    if (windows.length === 0 && metrics.length === 0) {
      return { status: "unavailable", configured: true, reason: "no usage data in response" };
    }
    return { status: "ok", windows, metrics };
  },
};
