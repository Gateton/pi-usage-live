// Shared test helpers.

import assert from "node:assert/strict";

/**
 * Fetch a rendered line, failing loudly if it is missing. Indexing a `string[]`
 * yields `string | undefined` under noUncheckedIndexedAccess, and silently
 * coercing that to "" would hide a card that rendered nothing.
 */
export function lineAt(lines: string[], index: number): string {
  const line = lines[index];
  assert.ok(line !== undefined, `expected a line at index ${index}, but only ${lines.length} were rendered`);
  return line;
}

export interface ThemeCall {
  color: string;
  text: string;
}

/**
 * A minimal stand-in for pi's Theme that records which colour each fragment was
 * asked to render in, and returns plain text so assertions stay readable.
 */
export function fakeTheme(): {
  theme: { fg: (color: string, text: string) => string; bold: (text: string) => string };
  calls: ThemeCall[];
  colorsUsed: () => string[];
} {
  const calls: ThemeCall[] = [];
  return {
    theme: {
      fg(color: string, text: string) {
        calls.push({ color, text });
        return text;
      },
      bold(text: string) {
        return text;
      },
    },
    calls,
    colorsUsed: () => calls.map((call) => call.color),
  };
}

/** A snapshot builder so tests only state the fields they care about. */
export function snapshot(overrides: Record<string, unknown> = {}): any {
  return {
    providerId: "test-provider",
    displayName: "Test",
    status: "ok",
    configured: true,
    windows: [],
    metrics: [],
    capturedAt: Date.now(),
    ...overrides,
  };
}

/** Replace global fetch for the duration of one test. */
export function stubFetch(handler: (url: string, init?: RequestInit) => { status?: number; body: unknown }): {
  restore: () => void;
  calls: Array<{ url: string; headers: Record<string, string> }>;
} {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    const { status = 200, body } = handler(String(url), init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  return { restore: () => { globalThis.fetch = original; }, calls };
}

/** A credential shaped like what the core hands an adapter. */
export function credential(): { headers: Record<string, string>; secrets: string[] } {
  return { headers: { Authorization: "Bearer test-token" }, secrets: ["test-token"] };
}

export const noAbort = { signal: new AbortController().signal } as { signal: AbortSignal };
