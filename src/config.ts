// The extension's own config file: ~/.pi/agent/pi-subscription-usage.json
//
// Every setting is optional; a missing or malformed file yields defaults rather
// than an error, because a usage widget must never be the reason pi fails to
// start. Unknown keys are preserved on save so a newer version's settings are not
// silently discarded by an older one.
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const CONFIG_FILE_NAME = "pi-subscription-usage.json";

export type CardAlign = "left" | "right";
/** What to colour a bar by. */
export type ColorMode = "thresholds" | "provider-severity";

export interface ExtensionConfig {
  /** Providers to display. Empty/absent means "all providers with a credential". */
  enabledProviders: string[];
  /** Providers to hide even if configured. */
  disabledProviders: string[];
  /** Where to anchor the card. */
  align: CardAlign;
  /** Whether the card starts visible in a new session. */
  visible: boolean;
  /** Active-poll interval in seconds. */
  pollIntervalSec: number;
  /** Percent used at which a bar turns yellow, then red. */
  warnPercent: number;
  criticalPercent: number;
  /** Colour from thresholds, or trust a provider-reported severity when present. */
  colorMode: ColorMode;
  /** Provider-specific selections, e.g. { "fireworks": "my-account" }. */
  targets: Record<string, string>;
}

export const DEFAULT_CONFIG: ExtensionConfig = {
  enabledProviders: [],
  disabledProviders: [],
  align: "right",
  visible: true,
  pollIntervalSec: 300,
  warnPercent: 60,
  criticalPercent: 85,
  colorMode: "provider-severity",
  targets: {},
};

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  return items.length === value.length ? items : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asPercent(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(0, parsed));
}

function asPositiveSeconds(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  // Floor at 30s: polling a quota endpoint faster than that is abusive and would
  // risk getting the user rate-limited by the provider they are trying to monitor.
  return Math.max(30, Math.floor(parsed));
}

function asTargets(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string" && raw.trim() !== "") out[key] = raw;
  }
  return out;
}

/** Merge a parsed JSON value over defaults. Never throws. */
export function normalizeConfig(raw: unknown): ExtensionConfig {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const warnPercent = asPercent(source.warnPercent, DEFAULT_CONFIG.warnPercent);
  const criticalPercent = asPercent(source.criticalPercent, DEFAULT_CONFIG.criticalPercent);

  return {
    enabledProviders: asStringArray(source.enabledProviders) ?? DEFAULT_CONFIG.enabledProviders,
    disabledProviders: asStringArray(source.disabledProviders) ?? DEFAULT_CONFIG.disabledProviders,
    align: source.align === "left" || source.align === "right" ? source.align : DEFAULT_CONFIG.align,
    visible: asBoolean(source.visible) ?? DEFAULT_CONFIG.visible,
    pollIntervalSec: asPositiveSeconds(source.pollIntervalSec, DEFAULT_CONFIG.pollIntervalSec),
    // Keep the pair ordered even if a user sets them the wrong way round; a red
    // threshold below the yellow one would make the palette nonsensical.
    warnPercent: Math.min(warnPercent, criticalPercent),
    criticalPercent: Math.max(warnPercent, criticalPercent),
    colorMode: source.colorMode === "thresholds" ? "thresholds" : DEFAULT_CONFIG.colorMode,
    targets: asTargets(source.targets) ?? DEFAULT_CONFIG.targets,
  };
}

export function configPath(agentDir: string): string {
  return join(agentDir, CONFIG_FILE_NAME);
}

export async function loadConfig(agentDir: string): Promise<ExtensionConfig> {
  try {
    const raw = await readFile(configPath(agentDir), "utf8");
    return normalizeConfig(JSON.parse(raw));
  } catch {
    // Missing or unparseable config is not an error worth surfacing.
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Write a config change, preserving any keys this version does not understand.
 * Best-effort: a failed write must not break the session.
 */
export async function saveConfig(agentDir: string, config: ExtensionConfig): Promise<void> {
  const path = configPath(agentDir);
  let existing: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  } catch {
    // No readable existing file: start from scratch.
  }

  const merged = { ...existing, ...config };
  const temporary = join(agentDir, `.${CONFIG_FILE_NAME}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    await rename(temporary, path);
  } catch {
    // Ignore: settings simply will not persist this time.
  }
}
