// Anthropic (Claude Max/Pro) — passive: parsed from after_provider_response headers.
// Zero extra network calls. Confirmed against a live response on this machine:
//
//   anthropic-ratelimit-unified-5h-utilization: "0.82"
//   anthropic-ratelimit-unified-5h-reset: "1790115000"
//   anthropic-ratelimit-unified-5h-status: "allowed"
//   anthropic-ratelimit-unified-7d-utilization: "0.06"
//   anthropic-ratelimit-unified-7d-reset: "1790604000"
//   anthropic-ratelimit-unified-7d-status: "allowed"
//
// utilization is a 0..1 fraction of quota *used*, reset is unix seconds.
import type { ProviderSnapshot, UsageWindow } from "../types.js";

function headerValue(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  // Headers arrive lower-cased in practice, but don't assume it.
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

function parseWindow(
  headers: Record<string, string> | undefined,
  windowKey: "5h" | "7d",
  label: string,
): UsageWindow | undefined {
  const utilizationRaw = headerValue(headers, `anthropic-ratelimit-unified-${windowKey}-utilization`);
  if (utilizationRaw === undefined) return undefined;
  const utilization = Number(utilizationRaw);
  if (!Number.isFinite(utilization)) return undefined;
  const resetRaw = headerValue(headers, `anthropic-ratelimit-unified-${windowKey}-reset`);
  const resetsAtSec = resetRaw !== undefined ? Number(resetRaw) : undefined;
  return {
    label,
    usedPercent: Math.max(0, Math.min(100, utilization * 100)),
    ...(Number.isFinite(resetsAtSec) ? { resetsAtSec: resetsAtSec as number } : {}),
  };
}

/** Build a snapshot from one real Anthropic response's headers. Returns undefined if no rate-limit headers are present. */
export function parseAnthropicHeaders(headers: Record<string, string> | undefined): ProviderSnapshot | undefined {
  const fiveHour = parseWindow(headers, "5h", "5h");
  const sevenDay = parseWindow(headers, "7d", "7d");
  const windows = [fiveHour, sevenDay].filter((w): w is UsageWindow => w !== undefined);
  if (windows.length === 0) return undefined;

  const status = headerValue(headers, "anthropic-ratelimit-unified-status");
  const notes: string[] = [];
  if (status && status !== "allowed") notes.push(`status: ${status}`);

  return {
    providerId: "anthropic",
    displayName: "Claude",
    status: "ok",
    windows,
    metrics: [],
    capturedAt: Date.now(),
  };
}
