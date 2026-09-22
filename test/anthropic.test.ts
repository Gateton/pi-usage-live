import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { anthropicAdapter } from "../src/providers/anthropic.js";
import { credential, noAbort, stubFetch } from "./helpers.js";

/**
 * Real response body captured from the OAuth usage endpoint on a live Claude Max
 * subscription, trimmed to the fields the adapter reads. Note the deliberate
 * contrast with the header path: here `utilization` is 0..100, not 0..1.
 */
const REAL_USAGE_BODY = {
  five_hour: {
    utilization: 100.0,
    resets_at: "2026-09-22T22:10:00.853133+00:00",
    limit_dollars: null,
    used_dollars: null,
    remaining_dollars: null,
    locked_reason: null,
  },
  seven_day: {
    utilization: 8.0,
    resets_at: "2026-09-28T14:00:00.853158+00:00",
    locked_reason: null,
  },
  seven_day_oauth_apps: null,
  seven_day_opus: null,
  seven_day_sonnet: null,
  seven_day_cowork: null,
  extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null },
  limits: [
    {
      kind: "session",
      group: "session",
      percent: 100,
      severity: "critical",
      resets_at: "2026-09-22T22:10:00.853133+00:00",
      scope: null,
      is_active: true,
    },
    {
      kind: "weekly_all",
      group: "weekly",
      percent: 8,
      severity: "normal",
      resets_at: "2026-09-28T14:00:00.853158+00:00",
      scope: null,
      is_active: false,
    },
  ],
  member_dashboard_available: false,
};

let restoreFetch: (() => void) | undefined;
afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
});

function stubBody(body: unknown) {
  const stub = stubFetch(() => ({ body }));
  restoreFetch = stub.restore;
  return stub;
}

describe("anthropic active query", () => {
  test("maps the real captured payload", async () => {
    stubBody(REAL_USAGE_BODY);

    const result = await anthropicAdapter.query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    assert.deepEqual(result.windows, [
      { label: "5h", usedPercent: 100, resetsAtSec: Math.floor(Date.parse("2026-09-22T22:10:00.853133+00:00") / 1000), severity: "critical" },
      { label: "7d", usedPercent: 8, resetsAtSec: Math.floor(Date.parse("2026-09-28T14:00:00.853158+00:00") / 1000), severity: "normal" },
    ]);
  });

  test("treats utilization as a percentage, not a fraction", async () => {
    // The header path reports 0.82 for 82%; this endpoint reports 82.0. Confusing the
    // two would show 1% instead of 82%, so pin the distinction down.
    stubBody({ five_hour: { utilization: 82.0, resets_at: "2026-09-22T22:10:00Z" } });

    const result = await anthropicAdapter.query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    assert.equal(result.windows[0]?.usedPercent, 82);
  });

  test("hits the official origin", async () => {
    const stub = stubBody(REAL_USAGE_BODY);
    await anthropicAdapter.query?.(credential() as any, noAbort as any);
    assert.equal(stub.calls[0]?.url, "https://api.anthropic.com/api/oauth/usage");
  });

  test("sends the resolved credential as a bearer token", async () => {
    const stub = stubBody(REAL_USAGE_BODY);
    await anthropicAdapter.query?.(credential() as any, noAbort as any);
    assert.equal(stub.calls[0]?.headers.Authorization, "Bearer test-token");
  });

  test("forces critical when a window reports a locked_reason", async () => {
    stubBody({
      five_hour: { utilization: 100, resets_at: "2026-09-22T22:10:00Z", locked_reason: "usage_limit" },
    });

    const result = await anthropicAdapter.query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    assert.equal(result.windows[0]?.severity, "critical");
  });

  test("includes model-specific weekly windows when the plan reports them", async () => {
    stubBody({
      five_hour: { utilization: 10 },
      seven_day: { utilization: 20 },
      seven_day_sonnet: { utilization: 30 },
      seven_day_opus: { utilization: 40 },
    });

    const result = await anthropicAdapter.query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    assert.deepEqual(result.windows.map((window) => window.label), ["5h", "7d", "7d sonnet", "7d opus"]);
  });

  test("omits windows the plan does not have", async () => {
    stubBody({ five_hour: { utilization: 10 }, seven_day_sonnet: null, seven_day_opus: null });

    const result = await anthropicAdapter.query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    assert.deepEqual(result.windows.map((window) => window.label), ["5h"]);
  });

  test("still returns windows when the limits list is missing", async () => {
    stubBody({ five_hour: { utilization: 55 }, seven_day: { utilization: 5 } });

    const result = await anthropicAdapter.query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    assert.equal(result.windows.length, 2);
    assert.equal(result.windows[0]?.severity, undefined, "no severity source, so none should be claimed");
  });

  test("reports unavailable on a payload with no usable windows", async () => {
    stubBody({ five_hour: null, seven_day: null });
    const result = await anthropicAdapter.query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "unavailable");
  });

  test("ignores an unparseable reset timestamp instead of guessing", async () => {
    stubBody({ five_hour: { utilization: 10, resets_at: "not a date" } });
    const result = await anthropicAdapter.query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    assert.equal(result.windows[0]?.resetsAtSec, undefined);
  });

  test("surfaces a 401 for API-key accounts without leaking the credential", async () => {
    // This endpoint rejects plain API keys, so an API-key user must get a clear
    // failure while passive capture keeps working for them.
    const stub = stubFetch(() => ({ status: 401, body: { error: "unauthorized" } }));
    restoreFetch = stub.restore;

    await assert.rejects(async () => {
      await anthropicAdapter.query?.(credential() as any, noAbort as any);
    }, (error: Error) => {
      assert.ok(!error.message.includes("test-token"), "credential leaked into the error");
      assert.match(error.message, /401/);
      return true;
    });
  });
});
