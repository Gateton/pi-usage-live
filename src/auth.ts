// Resolves a Bearer token for one provider via Pi's official
// ctx.modelRegistry.getProviderAuth(id) API (documented in extensions.md,
// "ctx.modelRegistry / ctx.model / ..."). Validates the resolved base URL
// against the provider's one official origin before returning anything —
// we never want to accidentally forward a credential to a custom/proxy
// endpoint that happens to share the provider id.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const OFFICIAL_ORIGINS: Record<string, string> = {
  "openai-codex": "https://chatgpt.com",
  "opencode-go": "https://opencode.ai",
  openrouter: "https://openrouter.ai",
};

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** Returns a bearer token for `providerId`, or undefined if no credential / origin mismatch. */
export async function resolveBearerToken(
  ctx: ExtensionContext,
  providerId: keyof typeof OFFICIAL_ORIGINS,
): Promise<string | undefined> {
  const registry = ctx.modelRegistry as unknown as {
    getProviderAuth?: (id: string) => Promise<
      | { auth: { apiKey?: string; headers?: Record<string, string | null>; baseUrl?: string } }
      | undefined
    >;
  };
  if (typeof registry.getProviderAuth !== "function") return undefined;

  const result = await registry.getProviderAuth(providerId);
  if (!result?.auth) return undefined;

  const { auth } = result;
  if (auth.baseUrl && originOf(auth.baseUrl) !== OFFICIAL_ORIGINS[providerId]) {
    // Custom/proxy base URL for this provider id — refuse to send its credential elsewhere.
    return undefined;
  }

  const authHeader = auth.headers?.Authorization ?? auth.headers?.authorization;
  const fromHeader = typeof authHeader === "string" ? authHeader.replace(/^Bearer\s+/i, "") : undefined;
  return fromHeader ?? auth.apiKey ?? undefined;
}
