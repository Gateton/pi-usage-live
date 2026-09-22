// OpenRouter — active poll. Per-key credit limit + spend, not a subscription window.
// Endpoint contract verified against @narumitw/pi-usage src/query.ts +
// src/providers/openrouter.ts: Bearer GET https://openrouter.ai/api/v1/key,
// JSON body data.{limit,limit_remaining,usage,usage_daily,usage_monthly,label}.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveBearerToken } from "../auth.js";
import { fetchAuthedJson } from "../fetch-json.js";
import type { ProviderSnapshot, UsageMetric } from "../types.js";

const OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key";

interface OpenRouterKeyPayload {
  data?: {
    label?: string;
    limit?: number | null;
    limit_remaining?: number | null;
    usage?: number;
    usage_daily?: number;
    usage_monthly?: number;
  };
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

export async function fetchOpenRouterSnapshot(ctx: ExtensionContext): Promise<ProviderSnapshot> {
  const base = { providerId: "openrouter" as const, displayName: "OpenRouter", capturedAt: Date.now() };
  const token = await resolveBearerToken(ctx, "openrouter");
  if (!token) {
    return { ...base, status: "unavailable", reason: "no active OpenRouter credential", windows: [], metrics: [] };
  }
  try {
    const payload = (await fetchAuthedJson(OPENROUTER_KEY_URL, token)) as OpenRouterKeyPayload;
    const data = payload.data;
    if (!data) {
      return { ...base, status: "unavailable", reason: "no usage data in response", windows: [], metrics: [] };
    }
    const metrics: UsageMetric[] = [];
    if (typeof data.limit === "number" && typeof data.limit_remaining === "number") {
      metrics.push({ label: "left", value: money(data.limit_remaining) });
    } else if (typeof data.usage === "number") {
      metrics.push({ label: "used", value: money(data.usage) });
    }
    if (typeof data.usage_daily === "number") metrics.push({ label: "today", value: money(data.usage_daily) });
    if (metrics.length === 0) {
      return { ...base, status: "unavailable", reason: "no usage data in response", windows: [], metrics: [] };
    }
    return { ...base, status: "ok", windows: [], metrics };
  } catch (err) {
    return { ...base, status: "unavailable", reason: err instanceof Error ? err.message : String(err), windows: [], metrics: [] };
  }
}
