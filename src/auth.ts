// Credential resolution, driven entirely by the adapter's declared authStyle and
// officialOrigins. Nothing here knows any provider by name.
//
// The critical invariant: a credential is only ever handed to an adapter after its
// resolved base URL has been checked against that provider's official origin. A
// user pointing a provider id at a custom or proxied endpoint must never have that
// credential forwarded to a third party.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ProviderAdapter, ResolvedCredential } from "./types.js";

interface RequestAuth {
  apiKey?: string;
  headers?: Record<string, string | null>;
  baseUrl?: string;
}

interface ProviderAuthResult {
  auth: RequestAuth;
  env?: Record<string, string>;
  source?: string;
}

/** Shape of the registry surface we rely on, narrowed defensively. */
interface AuthCapableRegistry {
  getProviderAuth?: (providerId: string) => Promise<ProviderAuthResult | undefined>;
}

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function bearerFrom(auth: RequestAuth): string | undefined {
  const header = auth.headers?.Authorization ?? auth.headers?.authorization;
  if (typeof header === "string" && header.trim() !== "") {
    return header.replace(/^Bearer\s+/i, "").trim();
  }
  return auth.apiKey?.trim() || undefined;
}

export type CredentialOutcome =
  | { ok: true; credential: ResolvedCredential }
  /** The user has no credential for this provider. Not an error. */
  | { ok: false; configured: false; reason: string }
  /** A credential exists but cannot be used safely. Worth surfacing. */
  | { ok: false; configured: true; reason: string };

/**
 * Resolve a credential for one adapter.
 *
 * Returns `configured: false` when the user simply is not logged in, so the
 * widget can hide that provider instead of showing a permanent error.
 */
export async function resolveCredential(
  ctx: ExtensionContext,
  adapter: ProviderAdapter,
): Promise<CredentialOutcome> {
  if (adapter.authStyle === "oauth-original") {
    // Pi exposes only the short-lived inference token, not the long-lived OAuth
    // credential some providers' usage APIs require. Report it plainly instead of
    // sending the wrong credential and getting a confusing failure back.
    return {
      ok: false,
      configured: true,
      reason: "needs the original OAuth credential, which pi does not expose",
    };
  }

  const registry = ctx.modelRegistry as unknown as AuthCapableRegistry;
  if (typeof registry.getProviderAuth !== "function") {
    return { ok: false, configured: true, reason: "pi is too old to resolve provider auth" };
  }

  let result: ProviderAuthResult | undefined;
  try {
    result = await registry.getProviderAuth(adapter.id);
  } catch (error) {
    return {
      ok: false,
      configured: true,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  if (!result?.auth) {
    return { ok: false, configured: false, reason: "no credential" };
  }

  const { auth } = result;

  // Origin check. Any mismatch means the credential belongs to somewhere else.
  if (auth.baseUrl !== undefined && auth.baseUrl !== "") {
    const origin = originOf(auth.baseUrl);
    if (origin !== undefined && !adapter.officialOrigins.includes(origin)) {
      return {
        ok: false,
        configured: true,
        reason: `${adapter.displayName} is pointed at a custom base URL, so its credential is not sent to the official usage endpoint`,
      };
    }
  }

  const rawAuthHeader = auth.headers?.Authorization ?? auth.headers?.authorization;
  const secrets = [auth.apiKey, typeof rawAuthHeader === "string" ? rawAuthHeader : undefined].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );

  if (adapter.authStyle === "raw") {
    const token = bearerFrom(auth);
    if (!token) return { ok: false, configured: false, reason: "no credential" };
    // Some monitor APIs want the bare key and reject a Bearer prefix.
    return { ok: true, credential: { headers: {}, secrets: [...secrets, token] } };
  }

  const token = bearerFrom(auth);
  if (!token) return { ok: false, configured: false, reason: "no credential" };
  return {
    ok: true,
    credential: { headers: { Authorization: `Bearer ${token}` }, secrets: [...secrets, token] },
  };
}
