import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { anthropicAdapter } from "../src/providers/anthropic.js";
import { openaiCodexAdapter } from "../src/providers/openai-codex.js";
import { openCodeGoAdapter } from "../src/providers/opencode-go.js";
import { openRouterAdapter } from "../src/providers/openrouter.js";
import { ADAPTERS, adapterIds, getAdapter, pollableAdapters } from "../src/providers/index.js";
import { credential, noAbort, stubFetch } from "./helpers.js";

/**
 * Real response headers captured from a live Anthropic request, so the parser is
 * tested against the provider's actual shape rather than an invented one.
 */
const REAL_ANTHROPIC_HEADERS: Record<string, string> = {
  "anthropic-ratelimit-unified-5h-utilization": "0.82",
  "anthropic-ratelimit-unified-5h-reset": "1790115000",
  "anthropic-ratelimit-unified-5h-status": "allowed",
  "anthropic-ratelimit-unified-7d-utilization": "0.06",
  "anthropic-ratelimit-unified-7d-reset": "1790604000",
  "anthropic-ratelimit-unified-7d-status": "allowed",
  "anthropic-ratelimit-unified-status": "allowed",
  "anthropic-ratelimit-unified-representative-claim": "five_hour",
  "content-type": "text/event-stream",
};

let restoreFetch: (() => void) | undefined;
afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
});

describe("registry", () => {
  test("exposes the expected adapters", () => {
    assert.deepEqual([...adapterIds()].sort(), [
      "anthropic",
      "deepseek",
      "kimi-coding",
      "minimax",
      "minimax-cn",
      "moonshotai",
      "moonshotai-cn",
      "openai-codex",
      "opencode-go",
      "openrouter",
      "zai",
      "zai-coding-cn",
    ]);
  });

  test("every adapter declares the fields the core relies on", () => {
    for (const adapter of ADAPTERS) {
      assert.ok(adapter.id.length > 0, `${adapter.id}: id`);
      assert.ok(adapter.displayName.length > 0, `${adapter.id}: displayName`);
      assert.ok(adapter.officialOrigins.length > 0, `${adapter.id}: needs at least one official origin`);
      for (const origin of adapter.officialOrigins) {
        assert.doesNotThrow(() => new URL(origin), `${adapter.id}: ${origin} must be a URL`);
        assert.equal(new URL(origin).origin, origin, `${adapter.id}: ${origin} must be a bare origin`);
      }
    }
  });

  test("rejects an unknown or missing provider id rather than guessing", () => {
    assert.equal(getAdapter("nope"), undefined);
    assert.equal(getAdapter(undefined), undefined);
    assert.equal(getAdapter("anthropic")?.id, "anthropic");
  });

  test("only exposes pollable adapters for timed polling", () => {
    for (const adapter of pollableAdapters()) assert.ok(adapter.query, `${adapter.id} lacks query`);
  });
});

describe("anthropic adapter (passive headers)", () => {
  test("parses the real captured headers", () => {
    const result = anthropicAdapter.fromResponseHeaders?.(REAL_ANTHROPIC_HEADERS);
    assert.ok(result && result.status === "ok");
    // Headers carry a 0..1 fraction; the card works in percent. 0.82 -> 82.
    assert.deepEqual(result.windows, [
      { label: "5h", usedPercent: 82, resetsAtSec: 1790115000 },
      { label: "7d", usedPercent: 6, resetsAtSec: 1790604000 },
    ]);
  });

  test("is case-insensitive about header names", () => {
    const upper: Record<string, string> = {};
    for (const [key, value] of Object.entries(REAL_ANTHROPIC_HEADERS)) upper[key.toUpperCase()] = value;
    assert.ok(anthropicAdapter.fromResponseHeaders?.(upper));
  });

  test("returns undefined when the response carries no quota headers", () => {
    assert.equal(anthropicAdapter.fromResponseHeaders?.({ "content-type": "text/event-stream" }), undefined);
    assert.equal(anthropicAdapter.fromResponseHeaders?.(undefined), undefined);
  });

  test("ignores malformed values instead of inventing numbers", () => {
    const result = anthropicAdapter.fromResponseHeaders?.({
      "anthropic-ratelimit-unified-5h-utilization": "not-a-number",
      "anthropic-ratelimit-unified-7d-utilization": "0.5",
    });
    assert.ok(result && result.status === "ok");
    assert.equal(result.windows.length, 1, "only the well-formed window should survive");
    assert.equal(result.windows[0]?.label, "7d");
  });

  test("marks the binding window when the account is being held back", () => {
    const result = anthropicAdapter.fromResponseHeaders?.({
      ...REAL_ANTHROPIC_HEADERS,
      "anthropic-ratelimit-unified-status": "rejected",
      "anthropic-ratelimit-unified-representative-claim": "five_hour",
    });
    assert.ok(result && result.status === "ok");
    // The claim arrives as "five_hour" but the window is labelled "5h".
    const binding = result.windows.find((window) => window.severity === "critical");
    assert.equal(binding?.label, "5h");
  });

  test("does not mark anything when the account is allowed", () => {
    const result = anthropicAdapter.fromResponseHeaders?.(REAL_ANTHROPIC_HEADERS);
    assert.ok(result && result.status === "ok");
    assert.ok(result.windows.every((window) => window.severity === undefined));
  });
});

describe("openai-codex adapter", () => {
  test("maps primary/secondary windows to 5h/7d", async () => {
    const stub = stubFetch(() => ({
      body: {
        rate_limit: {
          primary_window: { used_percent: 11, reset_at: 1790116915, limit_window_seconds: 18000 },
          secondary_window: { used_percent: 2, reset_at: 1790649669, limit_window_seconds: 604800 },
        },
        plan_type: "plus",
      },
    }));
    restoreFetch = stub.restore;

    const result = await openaiCodexAdapter.query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    assert.deepEqual(result.windows, [
      { label: "5h", usedPercent: 11, resetsAtSec: 1790116915 },
      { label: "7d", usedPercent: 2, resetsAtSec: 1790649669 },
    ]);
    assert.deepEqual(result.metrics, [{ label: "Plan", value: "plus" }]);
    assert.match(stub.calls[0]?.url ?? "", /^https:\/\/chatgpt\.com\//);
  });

  test("accepts numeric strings from the provider", async () => {
    const stub = stubFetch(() => ({
      body: { rate_limit: { primary_window: { used_percent: "42", reset_at: "1790116915" } } },
    }));
    restoreFetch = stub.restore;

    const result = await openaiCodexAdapter.query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    assert.equal(result.windows[0]?.usedPercent, 42);
  });

  test("reports unavailable on a malformed payload instead of throwing", async () => {
    const stub = stubFetch(() => ({ body: { unexpected: true } }));
    restoreFetch = stub.restore;

    const result = await openaiCodexAdapter.query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "unavailable");
  });

  test("surfaces HTTP failures without leaking the credential", async () => {
    const stub = stubFetch(() => ({ status: 401, body: { error: "nope" } }));
    restoreFetch = stub.restore;

    await assert.rejects(async () => {
      await openaiCodexAdapter.query?.(credential() as any, noAbort as any);
    }, (error: Error) => {
      assert.ok(!error.message.includes("test-token"), "credential leaked into the error");
      assert.match(error.message, /401/);
      return true;
    });
  });
});

describe("opencode-go adapter", () => {
  test("maps rolling/weekly/monthly windows", async () => {
    const stub = stubFetch(() => ({
      body: {
        usage: {
          rolling: { status: "ok", percent: 0, resetsAt: "2026-09-22T23:00:00.000Z" },
          weekly: { status: "ok", percent: 13, resetsAt: "2026-09-27T00:00:00.000Z" },
          monthly: { status: "ok", percent: 49, resetsAt: "2026-10-01T00:00:00.000Z" },
        },
      },
    }));
    restoreFetch = stub.restore;

    const result = await openCodeGoAdapter.query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    assert.deepEqual(result.windows.map((window) => window.label), ["rolling", "wk", "mo"]);
    assert.equal(result.windows[1]?.usedPercent, 13);
    assert.equal(result.windows[1]?.resetsAtSec, Math.floor(Date.parse("2026-09-27T00:00:00.000Z") / 1000));
  });

  test("flags a rate-limited window as critical", async () => {
    const stub = stubFetch(() => ({
      body: { usage: { rolling: { status: "rate-limited", percent: 100 } } },
    }));
    restoreFetch = stub.restore;

    const result = await openCodeGoAdapter.query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    assert.equal(result.windows[0]?.severity, "critical");
  });

  test("skips windows whose status it does not understand rather than guessing", async () => {
    const stub = stubFetch(() => ({
      body: { usage: { rolling: { status: "mystery", percent: 50 }, weekly: { status: "ok", percent: 10 } } },
    }));
    restoreFetch = stub.restore;

    const result = await openCodeGoAdapter.query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    assert.deepEqual(result.windows.map((window) => window.label), ["wk"]);
  });
});

describe("openrouter adapter", () => {
  test("shows the remaining cap when one exists", async () => {
    const stub = stubFetch(() => ({
      body: { data: { limit: 100, limit_remaining: 74.5, usage: 25.5, usage_daily: 1.25 } },
    }));
    restoreFetch = stub.restore;

    const result = await openRouterAdapter.query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    assert.deepEqual(result.windows, []);
    assert.deepEqual(result.metrics, [
      { label: "left", value: "$74.50" },
      { label: "today", value: "$1.25" },
    ]);
  });

  test("falls back to total spend when the key has no cap", async () => {
    const stub = stubFetch(() => ({ body: { data: { limit: null, usage: 0.07, usage_daily: 0.04 } } }));
    restoreFetch = stub.restore;

    const result = await openRouterAdapter.query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    assert.equal(result.metrics[0]?.label, "used");
    assert.equal(result.metrics[0]?.value, "$0.07");
    assert.ok(result.metrics.some((metric) => metric.value.includes("no spend cap")));
  });

  test("reports unavailable when there is nothing to show", async () => {
    const stub = stubFetch(() => ({ body: { data: {} } }));
    restoreFetch = stub.restore;

    const result = await openRouterAdapter.query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "unavailable");
  });
});
