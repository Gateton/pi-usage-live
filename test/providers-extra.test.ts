import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { deepSeekAdapter } from "../src/providers/deepseek.js";
import { kimiCodingAdapter } from "../src/providers/kimi-coding.js";
import { createMiniMaxAdapter } from "../src/providers/minimax.js";
import { createMoonshotAdapter } from "../src/providers/moonshot.js";
import { createZaiAdapter } from "../src/providers/zai.js";
import { credential, noAbort, rawCredential, stubFetch } from "./helpers.js";

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

function stubStatus(status: number, body: unknown) {
  const stub = stubFetch(() => ({ status, body }));
  restoreFetch = stub.restore;
  return stub;
}

describe("deepseek", () => {
  test("reports each currency as its own exact balance", async () => {
    stubBody({
      is_available: true,
      balance_infos: [
        { currency: "CNY", total_balance: "110.00", granted_balance: "10.00", topped_up_balance: "100.00" },
        { currency: "USD", total_balance: "20.00", granted_balance: "0.00", topped_up_balance: "20.00" },
      ],
    });

    const result = await deepSeekAdapter.query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    assert.deepEqual(result.windows, []);
    // Decimal strings pass through untouched: no float rounding between provider and display.
    assert.deepEqual(result.metrics, [
      { label: "CNY", value: "110.00" },
      { label: "USD", value: "20.00" },
    ]);
  });

  test("flags a funded account that cannot actually spend", async () => {
    stubBody({ is_available: false, balance_infos: [{ currency: "USD", total_balance: "5.00" }] });
    const result = await deepSeekAdapter.query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "unavailable");
    assert.match(result.reason, /cannot make API calls/);
  });

  test("reports unavailable when no balance is returned", async () => {
    stubBody({ is_available: true, balance_infos: [] });
    const result = await deepSeekAdapter.query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "unavailable");
  });
});

describe("moonshot", () => {
  test("global reports USD and China reports CNY", async () => {
    stubBody({ code: 0, data: { available_balance: 49.58894, voucher_balance: 0, cash_balance: 49.58894 }, status: true });

    const global = await createMoonshotAdapter("global").query?.(credential() as any, noAbort as any);
    assert.ok(global && global.status === "ok");
    assert.equal(global.metrics[0]?.label, "USD");
    assert.equal(global.metrics[0]?.value, "49.58894");

    const cn = await createMoonshotAdapter("cn").query?.(credential() as any, noAbort as any);
    assert.ok(cn && cn.status === "ok");
    assert.equal(cn.metrics[0]?.label, "CNY");
  });

  test("each region only ever calls its own origin", async () => {
    const stub = stubBody({ data: { available_balance: 1, cash_balance: 1 } });
    await createMoonshotAdapter("cn").query?.(credential() as any, noAbort as any);
    assert.match(stub.calls[0]?.url ?? "", /^https:\/\/api\.moonshot\.cn\//);
  });

  test("surfaces a negative cash balance as money owed", async () => {
    stubBody({ data: { available_balance: 0, voucher_balance: 0, cash_balance: -12.5 } });
    const result = await createMoonshotAdapter("global").query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    assert.deepEqual(result.metrics, [
      { label: "USD", value: "0" },
      { label: "USD owed", value: "12.5" },
    ]);
  });

  test("shows a voucher separately when one exists", async () => {
    stubBody({ data: { available_balance: 30, voucher_balance: 10, cash_balance: 20 } });
    const result = await createMoonshotAdapter("global").query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    assert.equal(result.metrics.length, 2);
    assert.equal(result.metrics[1]?.label, "USD voucher");
  });

  test("rejects a negative available balance rather than displaying it", async () => {
    stubBody({ data: { available_balance: -5, cash_balance: -5 } });
    const result = await createMoonshotAdapter("global").query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "unavailable");
  });
});

describe("kimi-coding", () => {
  const REAL_SHAPE = {
    usage: { limit: "2048", used: "214", remaining: "1834", resetTime: "2026-01-09T15:23:13.716839300Z" },
    limits: [
      {
        window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
        detail: { limit: "200", used: "139", remaining: "61", resetTime: "2026-01-06T13:33:02.7174Z" },
      },
    ],
  };

  test("reads the observed payload shape", async () => {
    stubBody(REAL_SHAPE);
    const result = await kimiCodingAdapter.query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");

    const weekly = result.windows.find((window) => window.label === "wk");
    assert.ok(weekly);
    assert.equal(Math.round(weekly.usedPercent ?? 0), 10); // 214 / 2048

    const rolling = result.windows.find((window) => window.label === "5h");
    assert.ok(rolling);
    assert.equal(Math.round(rolling.usedPercent ?? 0), 70); // 139 / 200
  });

  test("derives usage from remaining when used is absent", async () => {
    stubBody({ usage: { limit: "100", remaining: "74", resetTime: "2026-02-11T17:32:50.757941Z" } });
    const result = await kimiCodingAdapter.query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    assert.equal(Math.round(result.windows[0]?.usedPercent ?? 0), 26);
  });

  test("treats a limit with no counters as an untouched window", async () => {
    // The provider omits both counters on a window nothing has drawn from yet.
    stubBody({ usage: { limit: "100" } });
    const result = await kimiCodingAdapter.query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    assert.equal(result.windows[0]?.usedPercent, 0);
  });

  test("accepts the resetAt spelling as well as resetTime", async () => {
    stubBody({ usage: { limit: "100", used: "5", resetAt: "2026-02-11T17:32:50.757941Z" } });
    const result = await kimiCodingAdapter.query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    assert.equal(result.windows[0]?.resetsAtSec, Math.floor(Date.parse("2026-02-11T17:32:50.757941Z") / 1000));
  });

  test("drops a window whose time unit is not recognised instead of guessing", async () => {
    stubBody({
      usage: { limit: "100", used: "5" },
      limits: [{ window: { duration: 3, timeUnit: "TIME_UNIT_FORTNIGHT" }, detail: { limit: "10", used: "1" } }],
    });
    const result = await kimiCodingAdapter.query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    assert.deepEqual(result.windows.map((window) => window.label), ["wk"]);
  });

  test("an account without a rolling quota is a normal state, not a failure", async () => {
    stubBody({ usage: { limit: "2048", used: "214" }, limits: null });
    const result = await kimiCodingAdapter.query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    assert.deepEqual(result.windows.map((window) => window.label), ["wk"]);
  });
});

describe("minimax", () => {
  test("reads an explicit remaining percentage", async () => {
    stubBody({
      model_remains: [{ current_interval_remaining_percent: 85, end_time: 1790000000000 }],
      base_resp: { status_code: 0, status_msg: "success" },
    });

    const result = await createMiniMaxAdapter("global").query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    assert.equal(result.windows[0]?.label, "5h");
    assert.equal(result.windows[0]?.usedPercent, 15); // 100 - 85 remaining
  });

  test("does not treat HTTP 200 as success when base_resp reports an error", async () => {
    // This endpoint returns 200 even on failure; trusting the status code alone would
    // report a broken account as an empty one.
    stubBody({ model_remains: [], base_resp: { status_code: 1004, status_msg: "secret-ish text" } });

    const result = await createMiniMaxAdapter("global").query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "unavailable");
    assert.match(result.reason, /1004/);
    assert.doesNotMatch(result.reason, /secret-ish/, "provider message must not be echoed");
  });

  test("reads usage_count as used, which is its current meaning", async () => {
    stubBody({ model_remains: [{ current_interval_total_count: 100, current_interval_usage_count: 10 }] });
    const result = await createMiniMaxAdapter("global").query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    assert.equal(result.windows[0]?.usedPercent, 10);
  });

  test("clamps an impossible usage_count instead of emitting a negative meter", async () => {
    // A count above the total cannot be "used", so the row is contradictory. It must
    // never render as a negative or over-100 percentage.
    stubBody({ model_remains: [{ current_interval_total_count: 100, current_interval_usage_count: 150 }] });
    const result = await createMiniMaxAdapter("global").query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    const used = result.windows[0]?.usedPercent ?? -1;
    assert.ok(used >= 0 && used <= 100, `expected a clamped percentage, got ${used}`);
  });

  test("prefers an explicit remaining count over the ambiguous usage count", async () => {
    stubBody({
      model_remains: [
        { current_interval_total_count: 100, current_interval_usage_count: 999, current_interval_remaining_count: 40 },
      ],
    });
    const result = await createMiniMaxAdapter("global").query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    assert.equal(result.windows[0]?.usedPercent, 60);
  });

  test("reads both the rolling and weekly windows", async () => {
    stubBody({
      model_remains: [
        { current_interval_remaining_percent: 90, current_weekly_remaining_percent: 20 },
      ],
    });
    const result = await createMiniMaxAdapter("global").query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    assert.deepEqual(result.windows.map((window) => window.label), ["5h", "wk"]);
    assert.equal(result.windows[1]?.usedPercent, 80);
  });

  test("each region only ever calls its own origin", async () => {
    const stub = stubBody({ model_remains: [{ current_interval_remaining_percent: 50 }] });
    await createMiniMaxAdapter("cn").query?.(credential() as any, noAbort as any);
    assert.match(stub.calls[0]?.url ?? "", /^https:\/\/api\.minimaxi\.com\//);
  });
});

describe("zai", () => {
  test("reads a CREDIT_LIMIT window and derives its meter from the length", async () => {
    stubBody({
      code: 200,
      data: { limits: [{ type: "CREDIT_LIMIT", percentage: 13, windowMinutes: 300 }] },
    });

    const result = await createZaiAdapter("global").query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    assert.equal(result.windows[0]?.label, "5h");
    assert.equal(result.windows[0]?.usedPercent, 13);
  });

  test("accepts the legacy TOKENS_LIMIT type", async () => {
    stubBody({ data: { limits: [{ type: "TOKENS_LIMIT", percentage: 76, windowMinutes: 10080 }] } });
    const result = await createZaiAdapter("global").query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    assert.equal(result.windows[0]?.label, "wk");
    assert.equal(result.windows[0]?.usedPercent, 76);
  });

  test("converts a 0..1 ratio into a percentage", async () => {
    stubBody({ data: { limits: [{ percentage: 0.5, windowMinutes: 300 }] } });
    const result = await createZaiAdapter("global").query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");
    assert.equal(result.windows[0]?.usedPercent, 50);
  });

  test("translates documented business codes and never echoes the provider message", async () => {
    stubBody({ error: { code: 1309, message: "sk-secret-looking-text" } });
    const result = await createZaiAdapter("global").query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "unavailable");
    assert.match(result.reason, /expired/i);
    assert.doesNotMatch(result.reason, /sk-secret/);
  });

  test("treats a top-level code of 500 as opaque rather than a documented code", async () => {
    stubBody({ code: 500, data: { limits: [{ percentage: 42, windowMinutes: 300 }] } });
    const result = await createZaiAdapter("global").query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "ok", "500 is not a business code, so quota should still be read");
  });

  test("sends the bare key first and retries with the prefix on an auth rejection", async () => {
    // Public sources disagree on whether this endpoint wants "Bearer " or the bare key,
    // so the adapter covers both rather than breaking for half of users.
    let call = 0;
    const stub = stubFetch(() => {
      call += 1;
      return call === 1
        ? { status: 401, body: { error: "unauthorized" } }
        : { body: { data: { limits: [{ percentage: 10, windowMinutes: 300 }] } } };
    });
    restoreFetch = stub.restore;

    const result = await createZaiAdapter("global").query?.(rawCredential() as any, noAbort as any);
    assert.ok(result && result.status === "ok");

    // Only the quota endpoint is retried; the plan endpoint is a separate, later call.
    const quotaCalls = stub.calls.filter((call) => call.url.includes("/api/monitor/usage/quota/limit"));
    assert.equal(quotaCalls.length, 2);
    assert.equal(quotaCalls[0]?.headers.Authorization, "test-token", "first attempt should be the bare key");
    assert.equal(quotaCalls[1]?.headers.Authorization, "Bearer test-token", "retry should add the prefix");
  });

  test("does not retry a non-auth failure", async () => {
    const stub = stubStatus(500, { error: "boom" });
    await assert.rejects(async () => {
      await createZaiAdapter("global").query?.(rawCredential() as any, noAbort as any);
    });
    assert.equal(stub.calls.length, 1);
  });

  test("reports unavailable when the payload has no recognisable windows", async () => {
    stubBody({ data: { somethingElse: true } });
    const result = await createZaiAdapter("global").query?.(credential() as any, noAbort as any);
    assert.ok(result && result.status === "unavailable");
  });
});
