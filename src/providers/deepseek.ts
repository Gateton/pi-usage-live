// DeepSeek — current API account balance.
//
// Contract: the documented `GET https://api.deepseek.com/user/balance` with a Bearer
// credential, returning:
//   { is_available: true,
//     balance_infos: [ { currency: "CNY", total_balance: "110.00",
//                        granted_balance: "10.00", topped_up_balance: "100.00" } ] }
//
// Monetary values are decimal STRINGS and are kept as strings end to end, so no
// float rounding is ever introduced between the provider and the display. CNY and USD
// are never converted into each other or summed.
//
// This endpoint reports a balance only: it has no historical spend, no quota windows
// and no reset times, so nothing of the sort is claimed here.
import type { AdapterResult, ProviderAdapter, UsageMetric } from "../types.js";
import { asObject, asString, fetchJson } from "../fetch-json.js";

const BALANCE_URL = "https://api.deepseek.com/user/balance";

export const deepSeekAdapter: ProviderAdapter = {
  id: "deepseek",
  displayName: "DeepSeek",
  officialOrigins: ["https://api.deepseek.com"],
  authStyle: "bearer",

  async query(credential, ctx): Promise<AdapterResult> {
    const payload = asObject(
      await fetchJson(BALANCE_URL, {
        headers: credential.headers,
        secrets: credential.secrets,
        signal: ctx.signal,
        label: "DeepSeek balance endpoint",
      }),
    );
    if (!payload) return { status: "unavailable", configured: true, reason: "malformed response" };

    const metrics: UsageMetric[] = [];
    const infos = Array.isArray(payload.balance_infos) ? payload.balance_infos : [];
    for (const entry of infos) {
      const info = asObject(entry);
      const currency = asString(info?.currency);
      const total = asString(info?.total_balance);
      if (currency !== undefined && total !== undefined) {
        metrics.push({ label: currency, value: total });
      }
    }

    if (metrics.length === 0) {
      return { status: "unavailable", configured: true, reason: "no balance in response" };
    }

    // A funded-but-suspended account is worth saying out loud rather than showing a
    // balance that cannot actually be spent.
    if (payload.is_available === false) {
      return { status: "unavailable", configured: true, reason: "account cannot make API calls" };
    }

    return { status: "ok", windows: [], metrics };
  },
};
