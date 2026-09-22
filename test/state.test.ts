import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { DEFAULT_CONFIG } from "../src/config.js";
import { UsageState, WIDGET_ID } from "../src/state.js";
import { fakeTheme, snapshot } from "./helpers.js";

let dir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "psu-state-"));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

function newState(config = {}) {
  return new UsageState(dir, { ...DEFAULT_CONFIG, ...config });
}

/** Records what the state asked the UI to draw, with a working fake theme. */
function recordingCtx(modelProvider?: string) {
  const widgets: Array<{ id: string; value: unknown }> = [];
  const { theme } = fakeTheme();
  return {
    widgets,
    ctx: {
      hasUI: true,
      model: modelProvider === undefined ? undefined : { provider: modelProvider },
      ui: {
        theme,
        setWidget(id: string, value: unknown) {
          widgets.push({ id, value });
        },
      },
    } as any,
  };
}

describe("UsageState", () => {
  test("hides a provider the user has never had credentials for", async () => {
    const state = newState();
    await state.ingest(snapshot({ providerId: "never-configured", configured: false, status: "unavailable" }));
    assert.deepEqual(state.visibleSnapshots(), []);
  });

  test("keeps showing a provider that was configured once, even if it errors now", async () => {
    const state = newState();
    await state.ingest(snapshot({ providerId: "flaky", configured: true }));
    await state.ingest(snapshot({ providerId: "flaky", configured: false, status: "unavailable", reason: "auth expired" }));

    const visible = state.visibleSnapshots();
    assert.equal(visible.length, 1);
    assert.equal(visible[0]?.reason, "auth expired");
  });

  test("honours disabledProviders", async () => {
    const state = newState({ disabledProviders: ["beta"] });
    await state.ingest(snapshot({ providerId: "alpha", displayName: "Alpha", configured: true }));
    await state.ingest(snapshot({ providerId: "beta", displayName: "Beta", configured: true }));
    assert.deepEqual(state.visibleSnapshots().map((entry) => entry.providerId), ["alpha"]);
  });

  test("an enabledProviders list acts as an allow-list", async () => {
    const state = newState({ enabledProviders: ["beta"] });
    await state.ingest(snapshot({ providerId: "alpha", displayName: "Alpha", configured: true }));
    await state.ingest(snapshot({ providerId: "beta", displayName: "Beta", configured: true }));
    assert.deepEqual(state.visibleSnapshots().map((entry) => entry.providerId), ["beta"]);
  });

  test("orders providers by display name for a stable card", async () => {
    const state = newState();
    await state.ingest(snapshot({ providerId: "z", displayName: "Zeta", configured: true }));
    await state.ingest(snapshot({ providerId: "a", displayName: "Alpha", configured: true }));
    assert.deepEqual(state.visibleSnapshots().map((entry) => entry.displayName), ["Alpha", "Zeta"]);
  });
});

describe("UsageState.render", () => {
  test("draws the card when there is something to show", async () => {
    const state = newState();
    await state.ingest(snapshot({ providerId: "alpha", configured: true }));
    const { ctx, widgets } = recordingCtx("alpha");

    state.render(ctx);
    assert.equal(widgets.length, 1);
    assert.equal(widgets[0]?.id, WIDGET_ID);
    assert.equal(typeof widgets[0]?.value, "function", "expected the component-factory form");
  });

  test("clears the widget when nothing is visible", () => {
    const { ctx, widgets } = recordingCtx();
    newState().render(ctx);
    assert.equal(widgets[0]?.value, undefined);
  });

  test("clears the widget when the user hid it", async () => {
    const state = newState({ visible: false });
    await state.ingest(snapshot({ providerId: "alpha", configured: true }));
    const { ctx, widgets } = recordingCtx("alpha");

    state.render(ctx);
    assert.equal(widgets[0]?.value, undefined);
  });

  test("does nothing without a UI", async () => {
    const state = newState();
    await state.ingest(snapshot({ providerId: "alpha", configured: true }));
    const { ctx, widgets } = recordingCtx("alpha");
    ctx.hasUI = false;

    state.render(ctx);
    assert.equal(widgets.length, 0);
  });

  test("survives a ctx invalidated by session replacement", async () => {
    const state = newState();
    await state.ingest(snapshot({ providerId: "alpha", configured: true }));

    // This is exactly what pi does to a ctx after /reload, /new or /resume: every
    // property read throws. Rendering must swallow it — from a timer callback an
    // escaping throw becomes an unhandled rejection and kills the pi process.
    const staleCtx = new Proxy({}, {
      get() {
        throw new Error("This extension ctx is stale after session replacement or reload.");
      },
    }) as any;

    assert.doesNotThrow(() => state.render(staleCtx));
  });

  test("shows only the focused provider's row", async () => {
    const state = newState();
    await state.ingest(snapshot({ providerId: "alpha", displayName: "Alpha", configured: true }));
    await state.ingest(snapshot({ providerId: "beta", displayName: "Beta", configured: true }));

    const { ctx, widgets } = recordingCtx("beta");
    state.render(ctx);

    // The state hands the UI a factory; build the component it would draw.
    const factory = widgets[0]?.value as (() => { render(width: number): string[] }) | undefined;
    assert.equal(typeof factory, "function");

    const rendered = factory!().render(200).join("\n");
    assert.match(rendered, /Beta/);
    assert.doesNotMatch(rendered, /Alpha/);
  });
});
