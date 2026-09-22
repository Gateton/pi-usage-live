// OpenCode Go (OpenCode Zen plan) — active poll.
// Endpoint contract verified against @narumitw/pi-usage src/query.ts +
// src/providers/opencode-zen.ts: Bearer GET, JSON body with
// usage.{rolling,weekly,monthly}.{status,percent,resetsAt}.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveBearerToken } from "../auth.js";
import { fetchAuthedJson } from "../fetch-json.js";
import type { ProviderSnapshot, UsageWindow } from "../types.js";

const OPENCODE_GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";

const WINDOWS = [
  { key: "rolling", label: "rolling" },
  { key: "weekly", label: "wk" },
  { key: "monthly", label: "mo" },
] as const;

interface ZenWindow {
  status?: string;
  percent?: number;
  resetsAt?: string;
}
interface ZenPayload {
  usage?: Record<string, ZenWindow>;
}

function toWindow(label: string, raw: ZenWindow | undefined): UsageWindow | undefined {
  if (!raw || (raw.status !== "ok" && raw.status !== "rate-limited") || typeof raw.percent !== "number") {
    return undefined;
  }
  const resetsAtSec = raw.resetsAt ? Math.floor(Date.parse(raw.resetsAt) / 1000) : undefined;
  return {
    label,
    usedPercent: Math.max(0, Math.min(100, raw.percent)),
    ...(resetsAtSec !== undefined && Number.isFinite(resetsAtSec) ? { resetsAtSec } : {}),
  };
}

export async function fetchOpenCodeGoSnapshot(ctx: ExtensionContext): Promise<ProviderSnapshot> {
  const base = { providerId: "opencode-go" as const, displayName: "OC Go", capturedAt: Date.now() };
  const token = await resolveBearerToken(ctx, "opencode-go");
  if (!token) {
    return { ...base, status: "unavailable", reason: "no active OpenCode Go credential", windows: [], metrics: [] };
  }
  try {
    const payload = (await fetchAuthedJson(OPENCODE_GO_USAGE_URL, token)) as ZenPayload;
    const windows = WINDOWS.map((w) => toWindow(w.label, payload.usage?.[w.key])).filter(
      (w): w is UsageWindow => w !== undefined,
    );
    if (windows.length === 0) {
      return { ...base, status: "unavailable", reason: "no usage data in response", windows: [], metrics: [] };
    }
    return { ...base, status: "ok", windows, metrics: [] };
  } catch (err) {
    return { ...base, status: "unavailable", reason: err instanceof Error ? err.message : String(err), windows: [], metrics: [] };
  }
}
