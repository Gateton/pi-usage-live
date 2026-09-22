// Anthropic (Claude Max/Pro).
//
// Passive: every real inference response carries the account's unified rate-limit
// state, so this provider costs zero extra requests. Verified against a live
// response:
//
//   anthropic-ratelimit-unified-5h-utilization: "0.82"   (fraction of quota USED)
//   anthropic-ratelimit-unified-5h-reset:       "1790115000" (unix seconds)
//   anthropic-ratelimit-unified-7d-utilization: "0.06"
//   anthropic-ratelimit-unified-7d-reset:       "1790604000"
//
// Note the headers report a 0..1 fraction while the OAuth usage endpoint reports
// 0..100. Mixing the two up silently mis-scales every bar, so each parser
// normalises to percent at its own boundary.
//
// Active: Anthropic also exposes an OAuth usage endpoint that jcode uses. It is
// not required (passive capture already covers Claude whenever Claude is in use)
// and it is currently left unregistered, because it needs the OAuth access token
// rather than an inference credential. See docs/providers.md.
import type { AdapterResult, ProviderAdapter, UsageWindow } from "../types.js";
import { clampPercent } from "../fetch-json.js";

function headerValue(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  // Headers arrive lower-cased in practice, but never rely on that.
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : headers[key];
}

function parseWindow(
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

export const anthropicAdapter: ProviderAdapter = {
  id: "anthropic",
  displayName: "Claude",
  officialOrigins: ["https://api.anthropic.com"],
  authStyle: "bearer",

  fromResponseHeaders(headers): AdapterResult | undefined {
    const windows = [
      parseWindow(headers, "5h", "5h"),
      parseWindow(headers, "7d", "7d"),
    ].filter((window): window is UsageWindow => window !== undefined);

    if (windows.length === 0) return undefined;

    // A rejected/failed unified status means the account is being held back, so
    // mark the window the provider names as the binding constraint. The claim uses
    // the API's own vocabulary ("five_hour"), which must be mapped onto our labels.
    const status = headerValue(headers, "anthropic-ratelimit-unified-status");
    if (status && status !== "allowed") {
      const claim = headerValue(headers, "anthropic-ratelimit-unified-representative-claim");
      const bindingLabel = claim === "seven_day" ? "7d" : claim === "five_hour" ? "5h" : undefined;
      return {
        status: "ok",
        windows: windows.map((window) =>
          window.label === bindingLabel ? { ...window, severity: "critical" } : window,
        ),
        metrics: [],
      };
    }

    return { status: "ok", windows, metrics: [] };
  },
};
