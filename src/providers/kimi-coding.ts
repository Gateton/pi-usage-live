// Kimi For Coding — plan request windows.
//
// Contract: `GET https://api.kimi.com/coding/v1/usages` with a Bearer credential and
// `Accept: application/json`, returning:
//   { "usage":  { "limit": "2048", "used": "214", "remaining": "1834", "resetTime": "<iso>" },
//     "limits": [ { "window": { "duration": 300, "timeUnit": "TIME_UNIT_MINUTE" },
//                   "detail": { "limit": "200", "used": "139", "remaining": "61", "resetTime": "<iso>" } } ] }
//
// Three quirks this parser is built around, all observed in the wild:
//
// 1. Counters are strings, and their spelling has drifted across versions, so both
//    `used` and `remaining` are read and either timestamp spelling is accepted.
// 2. A row may omit BOTH counters on an untouched window, so a positive `limit` with
//    no counters means zero usage rather than unknown usage.
// 3. `limits` is absent (or null) for accounts with no rolling quota, which is a
//    normal state and not a failure.
//
// An unrecognised `timeUnit` drops that entry instead of guessing at a window length.
import type { AdapterResult, ProviderAdapter, UsageWindow } from "../types.js";
import { asNumber, asObject, asString, clampPercent, fetchJson } from "../fetch-json.js";

const USAGES_URL = "https://api.kimi.com/coding/v1/usages";

/** Minutes per recognised window unit. Anything else is treated as unknown. */
const UNIT_MINUTES: Record<string, number> = {
  TIME_UNIT_MINUTE: 1,
  TIME_UNIT_MINUTES: 1,
  TIME_UNIT_HOUR: 60,
  TIME_UNIT_HOURS: 60,
  TIME_UNIT_DAY: 1440,
  TIME_UNIT_DAYS: 1440,
};

interface Counters {
  limit?: number;
  used?: number;
  remaining?: number;
  resetAtSec?: number;
}

function readCounters(source: Record<string, unknown> | undefined): Counters | undefined {
  if (!source) return undefined;

  const limit = asNumber(source.limit);
  const used = asNumber(source.used);
  const remaining = asNumber(source.remaining);

  const resetRaw = asString(source.resetTime) ?? asString(source.resetAt);
  const parsedReset = resetRaw === undefined ? Number.NaN : Date.parse(resetRaw);
  const resetAtSec = Number.isNaN(parsedReset) ? undefined : Math.floor(parsedReset / 1000);

  return {
    ...(limit !== undefined ? { limit } : {}),
    ...(used !== undefined ? { used } : {}),
    ...(remaining !== undefined ? { remaining } : {}),
    ...(resetAtSec !== undefined ? { resetAtSec } : {}),
  };
}

/**
 * Percentage used, or undefined when the row cannot be read honestly.
 * A row with a limit but no counters is an untouched window: zero used.
 */
function usedPercent(counters: Counters | undefined): number | undefined {
  if (!counters) return undefined;
  const { limit, used, remaining } = counters;

  if (limit === undefined || limit <= 0) return undefined;
  if (used !== undefined) return clampPercent((used / limit) * 100);
  if (remaining !== undefined) return clampPercent(((limit - remaining) / limit) * 100);
  return 0;
}

/** Compact window label from the provider's own duration, e.g. 300 minutes -> "5h". */
function windowLabel(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function windowFromLimit(entry: unknown): UsageWindow | undefined {
  const limit = asObject(entry);
  if (!limit) return undefined;

  const window = asObject(limit.window);
  const duration = asNumber(window?.duration);
  const unit = asString(window?.timeUnit);
  if (duration === undefined || unit === undefined) return undefined;

  const unitMinutes = UNIT_MINUTES[unit];
  if (unitMinutes === undefined) return undefined;

  const counters = readCounters(asObject(limit.detail));
  const percent = usedPercent(counters);
  if (percent === undefined) return undefined;

  return {
    label: windowLabel(duration * unitMinutes),
    usedPercent: percent,
    ...(counters?.resetAtSec !== undefined ? { resetsAtSec: counters.resetAtSec } : {}),
  };
}

export const kimiCodingAdapter: ProviderAdapter = {
  id: "kimi-coding",
  displayName: "Kimi",
  officialOrigins: ["https://api.kimi.com"],
  authStyle: "bearer",

  async query(credential, ctx): Promise<AdapterResult> {
    const payload = asObject(
      await fetchJson(USAGES_URL, {
        headers: { ...credential.headers, Accept: "application/json" },
        secrets: credential.secrets,
        signal: ctx.signal,
        label: "Kimi usage endpoint",
      }),
    );
    if (!payload) return { status: "unavailable", configured: true, reason: "malformed response" };

    const windows: UsageWindow[] = [];

    // `limits[]` are the windows the service actually times; `usage` is the weekly
    // allowance. Weekly goes first so the rolling windows read as the detail.
    const weeklyPercent = usedPercent(readCounters(asObject(payload.usage)));
    if (weeklyPercent !== undefined) {
      const weekly = readCounters(asObject(payload.usage));
      windows.push({
        label: "wk",
        usedPercent: weeklyPercent,
        ...(weekly?.resetAtSec !== undefined ? { resetsAtSec: weekly.resetAtSec } : {}),
      });
    }

    const limits = Array.isArray(payload.limits) ? payload.limits : [];
    for (const entry of limits) {
      const window = windowFromLimit(entry);
      if (window) windows.push(window);
    }

    if (windows.length === 0) {
      return { status: "unavailable", configured: true, reason: "no usage windows in response" };
    }
    return { status: "ok", windows, metrics: [] };
  },
};
