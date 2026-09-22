// The one HTTP path every active adapter uses.
//
// Safety properties, kept in one place so no adapter has to remember them:
//   - redirects are refused (a redirect could move a credential to another host)
//   - the response body is size-bounded (a hostile or broken endpoint must not
//     exhaust memory)
//   - the request times out and honours the session's abort signal
//   - failures never carry the credential: callers pass `secrets` to scrub, and
//     this module only ever reports status codes and provider-supplied text
//   - a User-Agent identifies us, so providers can see who is calling

const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 8_000;

export class UsageFetchError extends Error {}

/** Remove any resolved secret from a message before it can reach a UI or a log. */
export function redact(message: string, secrets: readonly string[]): string {
  let out = message;
  for (const secret of secrets) {
    if (secret.length >= 8) out = out.split(secret).join("<redacted>");
  }
  return out;
}

export interface FetchJsonOptions {
  headers: Record<string, string>;
  /** Values to scrub from error messages. */
  secrets?: readonly string[];
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Human-readable endpoint name used in error messages. */
  label: string;
}

export async function fetchJson(url: string, options: FetchJsonOptions): Promise<unknown> {
  const { headers, secrets = [], label } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", abortFromCaller, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": "pi-subscription-usage", ...headers },
      redirect: "error",
      signal: controller.signal,
    });

    if (response.redirected) {
      throw new UsageFetchError(`${label} refused a redirected response`);
    }

    const text = await readBounded(response);
    if (!response.ok) {
      throw new UsageFetchError(`${label} returned HTTP ${response.status} ${response.statusText}`);
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new UsageFetchError(`${label} returned invalid JSON`);
    }
  } catch (error) {
    if (error instanceof UsageFetchError) throw new UsageFetchError(redact(error.message, secrets));
    if ((error as { name?: string })?.name === "AbortError") {
      if (options.signal?.aborted) throw new UsageFetchError(`${label} was cancelled`);
      throw new UsageFetchError(`${label} timed out after ${timeoutMs}ms`);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageFetchError(redact(`${label} failed: ${message}`, secrets));
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

async function readBounded(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return response.text();

  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new UsageFetchError("response exceeded the size bound");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

/** Narrow an unknown JSON value to an object, or undefined. */
export function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/** Read a finite number, accepting numeric strings. */
export function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}
