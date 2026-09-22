// OpenCode Go (OpenCode Zen plan).
//
// Endpoint contract cross-checked against @narumitw/pi-usage (MIT) before it was
// uninstalled: a Bearer GET returning
//   usage.{rolling,weekly,monthly}.{status, percent, resetsAt}
// where percent is already 0..100 and `status` gates whether the window is usable
// ("ok" | "rate-limited"). Unknown statuses are reported rather than guessed at.
import type { AdapterResult, ProviderAdapter, UsageWindow } from "../types.js";
import { asNumber, asObject, asString, clampPercent, fetchJson } from "../fetch-json.js";

const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";

const WINDOWS = [
  { key: "rolling", label: "rolling" },
  { key: "weekly", label: "wk" },
  { key: "monthly", label: "mo" },
] as const;

function toWindow(label: string, raw: unknown): UsageWindow | undefined {
  const window = asObject(raw);
  if (!window) return undefined;

  const status = asString(window.status);
  if (status !== "ok" && status !== "rate-limited") return undefined;

  const used = asNumber(window.percent);
  if (used === undefined) return undefined;

  const resetsAt = asString(window.resetsAt);
  const resetsAtSec = resetsAt === undefined ? undefined : Math.floor(Date.parse(resetsAt) / 1000);

  return {
    label,
    usedPercent: clampPercent(used),
    ...(resetsAtSec !== undefined && Number.isFinite(resetsAtSec) ? { resetsAtSec } : {}),
    ...(status === "rate-limited" ? { severity: "critical" } : {}),
  };
}

export const openCodeGoAdapter: ProviderAdapter = {
  id: "opencode-go",
  displayName: "OC Go",
  officialOrigins: ["https://opencode.ai"],
  authStyle: "bearer",

  async query(credential, ctx): Promise<AdapterResult> {
    const payload = asObject(
      await fetchJson(USAGE_URL, {
        headers: credential.headers,
        secrets: credential.secrets,
        signal: ctx.signal,
        label: "OpenCode Zen usage endpoint",
      }),
    );
    const usage = asObject(payload?.usage);
    if (!usage) return { status: "unavailable", configured: true, reason: "malformed response" };

    const windows = WINDOWS.map((entry) => toWindow(entry.label, usage[entry.key])).filter(
      (window): window is UsageWindow => window !== undefined,
    );

    if (windows.length === 0) {
      return { status: "unavailable", configured: true, reason: "no usage data in response" };
    }
    return { status: "ok", windows, metrics: [] };
  },
};
