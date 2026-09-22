// Anthropic (Claude Max/Pro).
//
// Two independent sources, both registered:
//
// 1. Passive — every real inference response carries the account's unified
//    rate-limit state, so this costs zero extra requests and refreshes as you work.
//    Verified live:
//      anthropic-ratelimit-unified-5h-utilization: "0.82"    (fraction USED)
//      anthropic-ratelimit-unified-5h-reset:       "1790115000"
//      anthropic-ratelimit-unified-7d-utilization: "0.06"
//      anthropic-ratelimit-unified-7d-reset:       "1790604000"
//    Note: headers report a 0..1 FRACTION while the OAuth usage endpoint reports
//    0..100. Mixing the two mis-scales every bar, so each path normalises at its own
//    boundary.
//
// 2. Active — the OAuth usage endpoint, verified live returning HTTP 200 for a
//    subscription token with no extra headers required:
//      five_hour: { utilization: 100.0, resets_at: "<iso8601>", locked_reason: null }
//      seven_day: { utilization: 8.0,   resets_at: "<iso8601>", locked_reason: null }
//      seven_day_sonnet / seven_day_opus: same shape, null unless the plan has them
//      limits: [{ kind: "session", percent: 100, severity: "critical", ... },
//               { kind: "weekly_all", percent: 8, severity: "normal", ... }]
//    This is what makes Claude update even when you are working on another provider,
//    and it is the only source that reports the provider's own severity.
//
//    Requires a subscription login. An Anthropic API key is rejected by this endpoint
//    (HTTP 401); passive capture still works for such accounts.
//
// The active endpoint lives on the same origin as the API, so officialOrigins covers
// both and no extra origin allowance is needed.
import type { AdapterResult, ProviderAdapter, UsageWindow } from "../types.js";
import { asNumber, asObject, asString, clampPercent, fetchJson } from "../fetch-json.js";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

function headerValue(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  // Headers arrive lower-cased in practice, but never rely on that.
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : headers[key];
}

/** ISO 8601 timestamp to unix seconds. */
function toEpochSeconds(value: unknown): number | undefined {
  const text = asString(value);
  if (text === undefined) return undefined;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? undefined : Math.floor(parsed / 1000);
}

// ---------------------------------------------------------------------------
// Passive
// ---------------------------------------------------------------------------

function parseHeaderWindow(
  headers: Record<string, string> | undefined,
  key: "5h" | "7d",
  label: string,
): UsageWindow | undefined {
  const utilization = Number(headerValue(headers, `anthropic-ratelimit-unified-${key}-utilization`));
  if (!Number.isFinite(utilization)) return undefined;

  const reset = Number(headerValue(headers, `anthropic-ratelimit-unified-${key}-reset`));
  return {
    label,
    usedPercent: clampPercent(utilization * 100),
    ...(Number.isFinite(reset) ? { resetsAtSec: reset } : {}),
  };
}

function fromResponseHeaders(headers: Record<string, string> | undefined): AdapterResult | undefined {
  const windows = [
    parseHeaderWindow(headers, "5h", "5h"),
    parseHeaderWindow(headers, "7d", "7d"),
  ].filter((window): window is UsageWindow => window !== undefined);

  if (windows.length === 0) return undefined;

  // A non-"allowed" unified status means the account is being held back, so mark the
  // window the provider names as the binding constraint. The claim uses the API's own
  // vocabulary ("five_hour"), which must be mapped onto our labels.
  const status = headerValue(headers, "anthropic-ratelimit-unified-status");
  if (status !== undefined && status !== "allowed") {
    const claim = headerValue(headers, "anthropic-ratelimit-unified-representative-claim");
    const binding = claim === "seven_day" ? "7d" : claim === "five_hour" ? "5h" : undefined;
    return {
      status: "ok",
      windows: windows.map((window) => (window.label === binding ? { ...window, severity: "critical" } : window)),
      metrics: [],
    };
  }

  return { status: "ok", windows, metrics: [] };
}

// ---------------------------------------------------------------------------
// Active
// ---------------------------------------------------------------------------

/** The windows this endpoint reports, in display order. */
const ACTIVE_WINDOWS = [
  { field: "five_hour", label: "5h", kinds: ["session"] },
  { field: "seven_day", label: "7d", kinds: ["weekly_all", "weekly"] },
  { field: "seven_day_sonnet", label: "7d sonnet", kinds: ["weekly_sonnet"] },
  { field: "seven_day_opus", label: "7d opus", kinds: ["weekly_opus"] },
] as const;

/**
 * Provider-reported severity per limit kind, e.g. { session: "critical" }.
 * Preferred over our own thresholds because the provider knows whether a window is
 * actually blocking you.
 */
function severityByKind(payload: Record<string, unknown>): Map<string, string> {
  const severities = new Map<string, string>();
  const limits = payload.limits;
  if (!Array.isArray(limits)) return severities;

  for (const entry of limits) {
    const limit = asObject(entry);
    if (!limit) continue;
    const kind = asString(limit.kind) ?? asString(limit.group);
    const severity = asString(limit.severity);
    if (kind !== undefined && severity !== undefined) severities.set(kind, severity);
  }
  return severities;
}

function parseActiveWindow(
  payload: Record<string, unknown>,
  spec: (typeof ACTIVE_WINDOWS)[number],
  severities: Map<string, string>,
): UsageWindow | undefined {
  const window = asObject(payload[spec.field]);
  if (!window) return undefined;

  const utilization = asNumber(window.utilization);
  if (utilization === undefined) return undefined;

  const resetsAtSec = toEpochSeconds(window.resets_at);
  const reported = spec.kinds.map((kind) => severities.get(kind)).find((value) => value !== undefined);

  // A non-null locked_reason means this window is actively blocking, regardless of
  // what the limit list says.
  const severity = asString(window.locked_reason) !== undefined ? "critical" : reported;

  return {
    label: spec.label,
    usedPercent: clampPercent(utilization),
    ...(resetsAtSec !== undefined ? { resetsAtSec } : {}),
    ...(severity !== undefined ? { severity } : {}),
  };
}

async function query(
  credential: { headers: Record<string, string>; secrets: string[] },
  ctx: { signal: AbortSignal },
): Promise<AdapterResult> {
  const payload = asObject(
    await fetchJson(USAGE_URL, {
      headers: credential.headers,
      secrets: credential.secrets,
      signal: ctx.signal,
      label: "Anthropic usage endpoint",
    }),
  );
  if (!payload) return { status: "unavailable", configured: true, reason: "malformed response" };

  const severities = severityByKind(payload);
  const windows = ACTIVE_WINDOWS.map((spec) => parseActiveWindow(payload, spec, severities)).filter(
    (window): window is UsageWindow => window !== undefined,
  );

  if (windows.length === 0) {
    return { status: "unavailable", configured: true, reason: "no usage data in response" };
  }
  return { status: "ok", windows, metrics: [] };
}

export const anthropicAdapter: ProviderAdapter = {
  id: "anthropic",
  displayName: "Claude",
  officialOrigins: ["https://api.anthropic.com"],
  authStyle: "bearer",
  fromResponseHeaders,
  query,
};
