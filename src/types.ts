// Core types. The extension core never names a provider: everything it knows about
// one arrives through a ProviderAdapter (see providers/).
//
// The shapes are deliberately wide enough to express every provider we intend to
// support, including the awkward ones:
//   - passive-only providers that expose nothing but response headers (Anthropic)
//   - active-only providers behind a documented usage endpoint
//   - providers wanting a raw API key rather than a Bearer token (Z.AI's monitor)
//   - providers needing the original OAuth credential rather than the short-lived
//     inference token minted from it (GitHub Copilot, xAI)
//   - regional twins sharing an implementation but not an origin (Moonshot,
//     MiniMax) whose credentials are not interchangeable
//   - providers with several billing targets where the user must pick one
//     (Fireworks multi-account)

/** A single quota window, e.g. Claude's 5h/7d or Codex's primary/secondary. */
export interface UsageWindow {
  /** Short label shown before the bar, e.g. "5h", "7d", "rolling". */
  label: string;
  /** 0-100 percent used. Undefined when the provider returned nothing usable. */
  usedPercent?: number;
  /** Unix seconds when this window resets, if the provider reports it. */
  resetsAtSec?: number;
  /**
   * Provider-reported severity ("normal" | "critical" | ...) when available.
   * Preferred over our own thresholds for colouring, because the provider knows
   * whether a window actually blocks you right now.
   */
  severity?: string;
}

/** A monetary or credit fact that is not a percentage window (spend, balance, credits). */
export interface UsageMetric {
  label: string;
  value: string;
}

/**
 * What an adapter reports. Adapters never set providerId/displayName/capturedAt —
 * the core stamps those on, so an adapter cannot get them subtly wrong.
 */
export type AdapterResult =
  | { status: "ok"; windows: UsageWindow[]; metrics: UsageMetric[] }
  | {
      status: "unavailable";
      /**
       * False when the user simply has no credential for this provider, in which
       * case the widget hides it rather than showing an error. This is an explicit
       * field rather than something inferred from the reason text, so that
       * rewording or translating a message can never change what is displayed.
       */
      configured: boolean;
      /** Human-readable detail. Must never contain a secret. */
      reason: string;
    };

export type ProviderStatus = "ok" | "unavailable";

/** One provider's usage at one point in time. */
export interface ProviderSnapshot {
  providerId: string;
  displayName: string;
  status: ProviderStatus;
  /** False when the user has no credential for this provider. */
  configured: boolean;
  /** Human-readable detail when status !== "ok". Never contains secrets. */
  reason?: string;
  windows: UsageWindow[];
  metrics: UsageMetric[];
  /** Wall-clock ms when this snapshot was captured. */
  capturedAt: number;
}

/** How a provider's credential must be presented to its usage endpoint. */
export type AuthStyle =
  /** `Authorization: Bearer <resolved inference credential>`. */
  | "bearer"
  /**
   * `Authorization: <credential>`, with no Bearer prefix. Some providers' monitor
   * APIs reject the prefix outright (Z.AI's quota endpoint is the known case), so the
   * distinction is the prefix, not the presence of the header.
   */
  | "raw"
  /**
   * Requires the long-lived OAuth credential the runtime inference token was
   * minted from, matched by exact token equality. Pi exposes only the short-lived
   * token, so such an adapter must recover the original itself and the core
   * reports it as unavailable until that is implemented.
   */
  | "oauth-original";

/** A credential resolved and origin-validated by the core, ready for one request. */
export interface ResolvedCredential {
  /** Headers to send. Never logged, never persisted. */
  headers: Record<string, string>;
  /** Values to scrub from any error surfaced to the user. */
  secrets: string[];
}

/** Context handed to an adapter's active query. */
export interface QueryContext {
  /** Abort when the session goes away. */
  signal: AbortSignal;
  /**
   * Provider-specific selection from config, for providers with more than one
   * billing target (e.g. a Fireworks account slug).
   */
  target?: string;
}

export interface ProviderAdapter {
  /** Pi provider id this adapter serves, e.g. "anthropic", "openai-codex". */
  id: string;
  /** Label shown in the widget. */
  displayName: string;
  /**
   * The provider's official origin(s). A resolved credential's base URL must match
   * one of these before we send it anywhere, so a user behind a custom or proxied
   * base URL never has their credential forwarded to a third party.
   */
  officialOrigins: readonly string[];
  /** How the credential must be presented. */
  authStyle: AuthStyle;

  /**
   * Passive capture: derive usage from a real inference response's headers. Costs
   * nothing and works for providers with no usage endpoint at all.
   */
  fromResponseHeaders?(headers: Record<string, string> | undefined): AdapterResult | undefined;

  /**
   * Active capture: query the provider's usage endpoint. Only called for adapters
   * that define it, and only when a credential resolved successfully.
   */
  query?(credential: ResolvedCredential, ctx: QueryContext): Promise<AdapterResult>;
}
