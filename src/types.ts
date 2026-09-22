// Shared types for the subscription-usage widget.

/** A single quota window (e.g. Claude's 5h/7d, Codex's primary/secondary). */
export interface UsageWindow {
  /** Short label shown before the bar, e.g. "5h", "7d", "rolling". */
  label: string;
  /** 0-100 percent used. Undefined when the provider didn't return a usable number. */
  usedPercent?: number;
  /** Unix seconds when this window resets, if known. */
  resetsAtSec?: number;
}

/** A monetary/credit fact that doesn't fit the percent-window model (spend, balance, credits left). */
export interface UsageMetric {
  label: string;
  value: string;
}

export type ProviderStatus = "ok" | "unavailable" | "stale";

export interface ProviderSnapshot {
  providerId: "anthropic" | "openai-codex" | "opencode-go" | "openrouter";
  displayName: string;
  status: ProviderStatus;
  /** Human-readable reason when status !== "ok" (auth expired, network error, etc). */
  reason?: string;
  windows: UsageWindow[];
  metrics: UsageMetric[];
  /** Wall-clock ms when this snapshot was captured. */
  capturedAt: number;
}

export interface UsageCacheFile {
  version: 1;
  snapshots: Partial<Record<ProviderSnapshot["providerId"], ProviderSnapshot>>;
}

export const ALL_PROVIDER_IDS: ProviderSnapshot["providerId"][] = [
  "anthropic",
  "openai-codex",
  "opencode-go",
  "openrouter",
];
