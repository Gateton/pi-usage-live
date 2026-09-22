// Shared, minimal-but-safe authenticated JSON fetch for the active pollers
// (openai-codex, opencode-go, openrouter). Mirrors the safety properties of
// @narumitw/pi-usage's fetchProviderJson without reimplementing its full
// fingerprinting/redaction machinery, which this personal-use widget doesn't need:
//   - only ever call the provider's one official origin
//   - reject redirects
//   - bound response size
//   - timeout via AbortSignal
//   - never log the resolved secret

const MAX_BODY_BYTES = 64 * 1024;

export class UsageFetchError extends Error {}

export async function fetchAuthedJson(
  url: string,
  bearerToken: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<unknown> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "User-Agent": "pi-subscription-usage",
      },
      redirect: "error",
      signal: controller.signal,
    });
    if (response.redirected) {
      throw new UsageFetchError("refused a redirected response");
    }
    const reader = response.body?.getReader();
    let text = "";
    if (reader) {
      let total = 0;
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) {
          await reader.cancel();
          throw new UsageFetchError("response exceeded size bound");
        }
        text += decoder.decode(value, { stream: true });
      }
    } else {
      text = await response.text();
    }
    if (!response.ok) {
      throw new UsageFetchError(`HTTP ${response.status} ${response.statusText}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new UsageFetchError("response was not valid JSON");
    }
  } catch (err) {
    if (err instanceof UsageFetchError) throw err;
    if ((err as { name?: string })?.name === "AbortError") {
      throw new UsageFetchError(`timed out after ${timeoutMs}ms`);
    }
    throw new UsageFetchError(err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
  }
}
