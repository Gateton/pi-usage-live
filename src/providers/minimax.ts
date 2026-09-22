// MiniMax — Token Plan quota windows (Global and China).
//
// Contract: `GET {origin}/v1/token_plan/remains` with a Bearer credential, returning
//   { "model_remains": [ { current_interval_total_count, current_interval_usage_count,
//                          current_interval_remaining_count?, current_interval_remaining_percent?,
//                          end_time, ... } ],
//     "base_resp": { "status_code": 0, "status_msg": "success" } }
//
// Two things worth knowing:
//
// 1. This endpoint returns HTTP 200 even for failures; the real status is in
//    `base_resp.status_code`. Treating 200 as success would report a broken account
//    as an empty one, so base_resp is checked first.
// 2. `*_usage_count` has drifted in meaning across versions: in some responses it
//    counts requests already USED, in others it is what REMAINS. Reading it backwards
//    would invert the meter, so an explicit percentage or remaining alias is always
//    preferred, and `usage_count` is only used when the total is available to sanity
//    check it against. Where neither is conclusive the row is dropped rather than
//    guessed at.
//
// One row is returned per model bucket (`general` for text and coding, `video`), each
// carrying a rolling interval window and a weekly window.
import type { AdapterResult, ProviderAdapter, UsageWindow } from "../types.js";
import { asNumber, asObject, asString, clampPercent, fetchJson } from "../fetch-json.js";

type Region = "global" | "cn";

const REGIONS: Record<Region, { id: string; displayName: string; origin: string }> = {
  global: { id: "minimax", displayName: "MiniMax", origin: "https://api.minimax.io" },
  cn: { id: "minimax-cn", displayName: "MiniMax CN", origin: "https://api.minimaxi.com" },
};

/** Windows reported per model row, in display order. */
const WINDOWS = [
  { prefix: "current_interval", label: "5h" },
  { prefix: "current_weekly", label: "wk" },
] as const;

function toEpochSeconds(value: unknown): number | undefined {
  // end_time arrives as epoch milliseconds in some responses and ISO in others.
  const numeric = asNumber(value);
  if (numeric !== undefined) return Math.floor(numeric > 1e11 ? numeric / 1000 : numeric);

  const text = asString(value);
  if (text === undefined) return undefined;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? undefined : Math.floor(parsed / 1000);
}

function readWindow(row: Record<string, unknown>, prefix: string, label: string): UsageWindow | undefined {
  const total = asNumber(row[`${prefix}_total_count`]);
  const percent = asNumber(row[`${prefix}_remaining_percent`]);

  const remaining =
    asNumber(row[`${prefix}_remaining_count`]) ??
    asNumber(row[`${prefix}_remains_count`]);

  let usedPercent: number | undefined;

  if (percent !== undefined) {
    // An explicit percentage is the provider's own answer; it wins.
    usedPercent = clampPercent(100 - percent);
  } else if (total !== undefined && total > 0 && remaining !== undefined) {
    usedPercent = clampPercent(((total - remaining) / total) * 100);
  } else if (total !== undefined && total > 0) {
    // Only `usage_count` is left, and its direction is ambiguous. Cross-check it: a
    // value above the total cannot be "used", so it must be "remaining" — which makes
    // the intended reading determinable without guessing.
    const usageCount = asNumber(row[`${prefix}_usage_count`]);
    if (usageCount === undefined) return undefined;
    usedPercent =
      usageCount > total
        ? clampPercent(((total - usageCount) / total) * 100)
        : clampPercent((usageCount / total) * 100);
  }

  if (usedPercent === undefined) return undefined;

  const resetsAtSec = toEpochSeconds(row[`${prefix}_end_time`]) ?? toEpochSeconds(row.end_time);
  return {
    label,
    usedPercent,
    ...(resetsAtSec !== undefined ? { resetsAtSec } : {}),
  };
}

export function createMiniMaxAdapter(region: Region): ProviderAdapter {
  const config = REGIONS[region];
  const url = `${config.origin}/v1/token_plan/remains`;

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
          label: `${config.displayName} token plan endpoint`,
        }),
      );
      if (!payload) return { status: "unavailable", configured: true, reason: "malformed response" };

      // HTTP 200 does not mean success here; base_resp carries the real status.
      const baseResp = asObject(payload.base_resp) ?? asObject(asObject(payload.data)?.base_resp);
      const statusCode = asNumber(baseResp?.status_code);
      if (statusCode !== undefined && statusCode !== 0) {
        // Never echo status_msg: provider messages can contain credential fragments.
        return {
          status: "unavailable",
          configured: true,
          reason: `provider reported error code ${statusCode}`,
        };
      }

      const rows = Array.isArray(payload.model_remains)
        ? payload.model_remains
        : Array.isArray(asObject(payload.data)?.model_remains)
          ? (asObject(payload.data)?.model_remains as unknown[])
          : [];

      const windows: UsageWindow[] = [];
      for (const entry of rows) {
        const row = asObject(entry);
        if (!row) continue;
        for (const spec of WINDOWS) {
          const window = readWindow(row, spec.prefix, spec.label);
          if (window) windows.push(window);
        }
        // The first row is the text/coding bucket, which is what pi's usage draws on.
        if (windows.length > 0) break;
      }

      if (windows.length === 0) {
        return { status: "unavailable", configured: true, reason: "no quota windows in response" };
      }
      return { status: "ok", windows, metrics: [] };
    },
  };
}
