// Z.AI (GLM Coding Plan) — quota windows, plus the plan name when available.
//
// Contract: the undocumented `GET {origin}/api/monitor/usage/quota/limit` that Z.AI's
// own coding plugin uses, plus `GET {origin}/api/biz/subscription/list` for the plan
// name. Undocumented means it can change without notice, so every field is read
// defensively and an unrecognised shape reports unavailable rather than a wrong meter.
//
// Known drift this parser absorbs:
//   - window entries were `TOKENS_LIMIT` and are now `CREDIT_LIMIT`; both are accepted
//   - window length decides the meter: sub-daily is the session limit, longer is weekly
//   - failures arrive as a business code in `error.code` (nested, preferred) or a
//     top-level `code`, and a top-level `code: 500` is NOT a documented business code
//
// Authentication is genuinely ambiguous in public sources: one implementation documents
// that the monitor rejects a `Bearer` prefix and wants the bare key, while others send
// the prefix. Rather than pick a side and break for half of users, the request is made
// with the bare key and retried once with the prefix if the endpoint rejects it.
//
// Provider messages (`msg`, `error.message`) are never echoed: they can contain
// credential fragments. Only numeric codes are surfaced.
import type { AdapterResult, ProviderAdapter, UsageWindow } from "../types.js";
import { asNumber, asObject, asString, clampPercent, fetchJson, UsageFetchError } from "../fetch-json.js";

type Region = "global" | "cn";

const REGIONS: Record<Region, { id: string; displayName: string; origin: string }> = {
  global: { id: "zai", displayName: "Z.AI", origin: "https://api.z.ai" },
  cn: { id: "zai-coding-cn", displayName: "Z.AI CN", origin: "https://open.bigmodel.cn" },
};

/** Documented Z.AI business codes worth translating, since the raw numbers are opaque. */
const BUSINESS_CODES: Record<string, string> = {
  "1113": "insufficient balance or no resource package",
  "1309": "GLM Coding Plan expired",
};

/** Field names a percentage has appeared under. */
const PERCENT_KEYS = ["percentage", "usedPercent", "used_percent", "percent", "usagePercent", "usedRatio"];
/** Field names a window length has appeared under, in minutes. */
const WINDOW_MINUTE_KEYS = ["windowMinutes", "window_minutes", "duration", "windowLength", "periodMinutes"];

function firstNumber(source: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = asNumber(source[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** Success codes the monitor may report; anything else is a business failure. */
const SUCCESS_CODES = new Set(["0", "200"]);
/**
 * A top-level `code: 500` is not a documented business code and must not be treated as
 * HTTP 500 or as proof the credential lacks a Coding Plan, so it is ignored rather than
 * reported.
 */
const IGNORED_CODES = new Set(["500"]);

/**
 * Business code from a nested error first, then the top level.
 * Returns undefined when the payload reports success or a code we must not interpret.
 */
function businessCode(payload: Record<string, unknown>): string | undefined {
  const nested = asObject(payload.error);
  const nestedCode = nested?.code;
  const nestedText = typeof nestedCode === "number" ? String(nestedCode) : asString(nestedCode);
  if (nestedText !== undefined && !SUCCESS_CODES.has(nestedText)) return nestedText;

  const top = payload.code;
  const topText = typeof top === "number" ? String(top) : asString(top);
  if (topText === undefined || SUCCESS_CODES.has(topText) || IGNORED_CODES.has(topText)) return undefined;
  return topText;
}

/** Sub-daily windows are the session limit; anything longer is the weekly quota. */
function labelForMinutes(minutes: number | undefined): string {
  if (minutes === undefined) return "limit";
  return minutes < 1440 ? (minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`) : "wk";
}

function parseWindow(entry: unknown): UsageWindow | undefined {
  const limit = asObject(entry);
  if (!limit) return undefined;

  const percent = firstNumber(limit, PERCENT_KEYS);
  if (percent === undefined) return undefined;

  // A ratio in 0..1 is converted; anything above 1 is already a percentage.
  const usedPercent = clampPercent(percent <= 1 ? percent * 100 : percent);
  const minutes = firstNumber(limit, WINDOW_MINUTE_KEYS);
  const resetsAtSec = firstNumber(limit, ["resetsAt", "resetAt", "resetTime"]);

  return {
    label: labelForMinutes(minutes),
    usedPercent,
    ...(resetsAtSec !== undefined ? { resetsAtSec } : {}),
  };
}

function extractWindows(payload: Record<string, unknown>): UsageWindow[] {
  const data = asObject(payload.data);
  const raw = payload.limits ?? data?.limits;
  if (!Array.isArray(raw)) return [];

  const windows: UsageWindow[] = [];
  for (const entry of raw) {
    const window = parseWindow(entry);
    if (window) windows.push(window);
  }
  return windows;
}

async function fetchQuota(url: string, credential: { headers: Record<string, string>; secrets: string[] }, ctx: { signal: AbortSignal }) {
  const label = "Z.AI quota endpoint";
  try {
    return await fetchJson(url, {
      headers: credential.headers,
      secrets: credential.secrets,
      signal: ctx.signal,
      label,
    });
  } catch (error) {
    // Only an auth rejection is worth retrying, and only in the other documented form.
    const isAuthRejection = error instanceof UsageFetchError && /\b(401|403)\b/.test(error.message);
    const authorization = credential.headers.Authorization;
    if (!isAuthRejection || authorization === undefined || authorization.startsWith("Bearer ")) throw error;

    return await fetchJson(url, {
      headers: { ...credential.headers, Authorization: `Bearer ${authorization}` },
      secrets: credential.secrets,
      signal: ctx.signal,
      label,
    });
  }
}

export function createZaiAdapter(region: Region): ProviderAdapter {
  const config = REGIONS[region];

  return {
    id: config.id,
    displayName: config.displayName,
    officialOrigins: [config.origin],
    // The bare key, no "Bearer " prefix. See the retry above for why.
    authStyle: "raw",

    async query(credential, ctx): Promise<AdapterResult> {
      const payload = asObject(await fetchQuota(`${config.origin}/api/monitor/usage/quota/limit`, credential, ctx));
      if (!payload) return { status: "unavailable", configured: true, reason: "malformed response" };

      const code = businessCode(payload);
      if (code !== undefined) {
        const hint = BUSINESS_CODES[code];
        return {
          status: "unavailable",
          configured: true,
          reason: hint === undefined ? `provider reported error code ${code}` : hint,
        };
      }

      const windows = extractWindows(payload);
      if (windows.length === 0) {
        return { status: "unavailable", configured: true, reason: "no quota windows in response" };
      }

      // The plan endpoint only ever contributes the plan name, and its failure must not
      // hide quota that was already read successfully.
      const metrics: Array<{ label: string; value: string }> = [];
      try {
        const plan = asObject(
          await fetchJson(`${config.origin}/api/biz/subscription/list`, {
            headers: credential.headers,
            secrets: credential.secrets,
            signal: ctx.signal,
            label: "Z.AI subscription endpoint",
          }),
        );
        const planName = plan === undefined ? undefined : asString(asObject(plan.data)?.planName ?? plan.planName);
        if (planName !== undefined) metrics.push({ label: "plan", value: planName });
      } catch {
        // Quota already succeeded; a missing plan name is not worth failing over.
      }

      return { status: "ok", windows, metrics };
    },
  };
}
