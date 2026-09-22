// Moonshot AI — current API account balance, in two independent regions.
//
// Contract: `GET {origin}/v1/users/me/balance` with a Bearer credential, returning
//   { code: 0, data: { available_balance, voucher_balance, cash_balance }, status: true }
//
// Global (api.moonshot.ai) reports USD; China (api.moonshot.cn) reports CNY. The two
// are separate providers with separate credentials — pi maps both to the same
// MOONSHOT_API_KEY environment variable, so a shared env key is only valid for the
// region actually selected, and this adapter never falls back to the sibling region.
//
// available and voucher balances must be non-negative; cash may be negative when the
// account owes money, which is reported rather than clamped.
//
// Like DeepSeek's, this endpoint reports a balance only — no spend history, no quota
// windows, no reset times.
import type { AdapterResult, ProviderAdapter, UsageMetric } from "../types.js";
import { asNumber, asObject, fetchJson } from "../fetch-json.js";

type Region = "global" | "cn";

const REGIONS: Record<Region, { id: string; displayName: string; origin: string; currency: string }> = {
  global: { id: "moonshotai", displayName: "Moonshot", origin: "https://api.moonshot.ai", currency: "USD" },
  cn: { id: "moonshotai-cn", displayName: "Moonshot CN", origin: "https://api.moonshot.cn", currency: "CNY" },
};

function amount(value: unknown, { allowNegative }: { allowNegative: boolean }): number | undefined {
  const parsed = asNumber(value);
  if (parsed === undefined) return undefined;
  if (!allowNegative && parsed < 0) return undefined;
  return parsed;
}

function money(value: number): string {
  // Keep the provider's own precision: balances are small and rounding to cents
  // would hide the difference between a nearly-empty account and an empty one.
  return value.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
}

export function createMoonshotAdapter(region: Region): ProviderAdapter {
  const config = REGIONS[region];
  const url = `${config.origin}/v1/users/me/balance`;

  return {
    id: config.id,
    displayName: config.displayName,
    officialOrigins: [config.origin],
    authStyle: "bearer",

    async query(credential, ctx): Promise<AdapterResult> {
      const payload = asObject(
        await fetchJson(url, {
          headers: credential.headers,
          secrets: credential.secrets,
          signal: ctx.signal,
          label: `${config.displayName} balance endpoint`,
        }),
      );
      const data = asObject(payload?.data);
      if (!data) return { status: "unavailable", configured: true, reason: "malformed response" };

      const available = amount(data.available_balance, { allowNegative: false });
      if (available === undefined) {
        return { status: "unavailable", configured: true, reason: "no available balance in response" };
      }

      const metrics: UsageMetric[] = [{ label: config.currency, value: money(available) }];

      const voucher = amount(data.voucher_balance, { allowNegative: false });
      if (voucher !== undefined && voucher > 0) {
        metrics.push({ label: `${config.currency} voucher`, value: money(voucher) });
      }

      const cash = amount(data.cash_balance, { allowNegative: true });
      if (cash !== undefined && cash < 0) {
        // Owing money is a distinct, actionable state, not a small balance.
        metrics.push({ label: `${config.currency} owed`, value: money(Math.abs(cash)) });
      }

      return { status: "ok", windows: [], metrics };
    },
  };
}
