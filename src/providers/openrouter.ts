// OpenRouter — per-key credit limits and spend, not a subscription window.
//
// Endpoint contract cross-checked against @narumitw/pi-usage (MIT) before it was
// uninstalled: a Bearer GET returning
//   data.{limit, limit_remaining, usage, usage_daily, usage_weekly, usage_monthly, label}
// `limit: null` means the key has no spend cap, which is reported as such rather
// than shown as a zero limit.
import type { AdapterResult, ProviderAdapter, UsageMetric } from "../types.js";
import { asNumber, asObject, asString, fetchJson } from "../fetch-json.js";

const KEY_URL = "https://openrouter.ai/api/v1/key";

function money(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export const openRouterAdapter: ProviderAdapter = {
  id: "openrouter",
  displayName: "OpenRouter",
  officialOrigins: ["https://openrouter.ai"],
  authStyle: "bearer",

  async query(credential, ctx): Promise<AdapterResult> {
    const payload = asObject(
      await fetchJson(KEY_URL, {
        headers: credential.headers,
        secrets: credential.secrets,
        signal: ctx.signal,
        label: "OpenRouter key endpoint",
      }),
    );
    const data = asObject(payload?.data);
    if (!data) return { status: "unavailable", configured: true, reason: "malformed response" };

    const metrics: UsageMetric[] = [];
    const limit = asNumber(data.limit);
    const remaining = asNumber(data.limit_remaining);
    const usage = asNumber(data.usage);

    // Prefer the remaining cap when one exists; otherwise show total spend.
    if (limit !== undefined && remaining !== undefined) {
      metrics.push({ label: "left", value: money(remaining) });
    } else if (usage !== undefined) {
      metrics.push({ label: "used", value: money(usage) });
    }

    const daily = asNumber(data.usage_daily);
    if (daily !== undefined) metrics.push({ label: "today", value: money(daily) });

    if (metrics.length === 0) {
      return { status: "unavailable", configured: true, reason: "no usage data in response" };
    }

    const notes: string[] = [];
    if (data.limit === null) notes.push("no spend cap");
    if (data.is_free_tier === true) notes.push("free tier");

    return {
      status: "ok",
      windows: [],
      metrics: notes.length > 0 ? [...metrics, { label: "note", value: notes.join(", ") }] : metrics,
    };
  },
};
