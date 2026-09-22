# pi-subscription-usage

An always-on subscription usage card for [pi](https://pi.dev). See how much of your
plan allowance you have left — at a glance, without asking.

```
                                    ╭──────────────────────────────────────╮
                                    │ Claude                               │
                                    │ 5h  ███████████████ 100% (2h53m)     │
                                    │ 7d  █░░░░░░░░░░░░░░   8% (5d18h)     │
                                    ╰──────────────────────────────────────╯
```

The card docks in the bottom-right corner and follows the model you are currently
using, so it always shows the allowance that actually applies to your next request.
`/usage all` expands it to every configured provider.

## Why

pi's built-in footer already reports token, cache, cost and context usage for the
current session. What it does not report is **subscription-window quota**: Claude's
rolling 5h/7d allowance, ChatGPT Codex's rate-limit windows, a Zen plan's weekly
budget. This extension fills that gap, as a persistent card rather than a one-shot
command.

## Install

```bash
pi install npm:pi-subscription-usage
```

From a git checkout:

```bash
pi install git:github.com/YOUR_GITHUB_USER/pi-subscription-usage
```

Or try it without installing:

```bash
pi -e npm:pi-subscription-usage
```

## Supported providers

| Provider | Data | How it is obtained |
|---|---|---|
| **Anthropic (Claude Max/Pro)** | 5h and 7d windows, plus model-specific weekly windows when the plan has them | Passive **and** active |
| **OpenAI Codex (ChatGPT)** | 5h and 7d windows, plan | Active poll |
| **OpenCode Go (Zen)** | rolling, weekly, monthly | Active poll |
| **OpenRouter** | per-key credit limit and spend | Active poll |

A provider you have not logged into is simply not shown. Nothing appears as a
permanent error for a provider you do not use.

**Passive** means the provider reports quota in the headers of responses you were
already making, so the card updates as you work and costs zero extra requests.
**Active** means polling the provider's documented usage endpoint.

Anthropic supports both, deliberately:

- Passive capture keeps the numbers live while you are working in Claude, for free.
- The active poll is what keeps Claude current while you work in *another* provider,
  and it is the only source that reports the provider's own severity rating — the
  difference between a window that is merely high and one that is actually blocking
  you.

When both sources have data for one provider they are **merged** by window and metric
label, with the fresher value winning. Otherwise the sparse passive update would
erase windows that only the poll knows about.

> Anthropic's usage endpoint requires a subscription login. An API key is rejected
> by that endpoint, so an API-key account falls back to passive capture alone.

> Only the four providers above are currently implemented, and each was verified
> against a live account. Adding another is a single file — see
> [Adding a provider](#adding-a-provider).

## Commands

| Command | Effect |
|---|---|
| `/usage` | Toggle the card |
| `/usage all` | Show every configured provider (not just the current model's) |
| `/usage compact` | Back to just the current model's provider |
| `/usage show` / `/usage hide` | Explicit show or hide |
| `/usage align` | Flip between the right corner and left |
| `/usage refresh` | Force an immediate poll |
| `/usage reload` | Re-read the config file |

Visibility and alignment are saved, so they survive a restart.

## Configuration

Optional. `~/.pi/agent/pi-subscription-usage.json`:

```json
{
  "align": "right",
  "visible": true,
  "pollIntervalSec": 300,
  "warnPercent": 60,
  "criticalPercent": 85,
  "colorMode": "provider-severity",
  "enabledProviders": [],
  "disabledProviders": [],
  "targets": {}
}
```

| Key | Default | Meaning |
|---|---|---|
| `align` | `"right"` | Anchor the card right or left |
| `visible` | `true` | Whether it starts shown |
| `pollIntervalSec` | `300` | Active-poll interval, floored at 30s |
| `warnPercent` | `60` | Percent used at which a bar turns yellow |
| `criticalPercent` | `85` | Percent used at which a bar turns red |
| `colorMode` | `"provider-severity"` | Trust a provider's own severity, or use pure thresholds |
| `enabledProviders` | `[]` | Allow-list; empty means all |
| `disabledProviders` | `[]` | Deny-list, applied after the allow-list |
| `targets` | `{}` | Provider-specific selection, e.g. a Fireworks account |

A missing or malformed file falls back to defaults rather than failing, and unknown
keys are preserved when the extension saves a change.

## Adding a provider

Adding one is a single file plus one line. Create
`src/providers/<id>.ts` exporting a `ProviderAdapter`:

```ts
import type { AdapterResult, ProviderAdapter } from "../types.js";
import { clampPercent, asNumber, asObject, fetchJson } from "../fetch-json.js";

export const exampleAdapter: ProviderAdapter = {
  // Must match pi's provider id exactly — this is how the adapter is found.
  id: "example",
  displayName: "Example",
  // Your credential is only ever sent here. A user whose base URL does not match
  // is reported as unavailable instead of having their credential forwarded.
  officialOrigins: ["https://api.example.com"],
  authStyle: "bearer",

  async query(credential, ctx): Promise<AdapterResult> {
    const payload = asObject(
      await fetchJson("https://api.example.com/usage", {
        headers: credential.headers,
        secrets: credential.secrets,
        signal: ctx.signal,
        label: "Example usage endpoint",
      }),
    );

    const used = asNumber(payload?.used_percent);
    if (used === undefined) {
      return { status: "unavailable", configured: true, reason: "no usage data in response" };
    }

    return {
      status: "ok",
      windows: [{ label: "5h", usedPercent: clampPercent(used) }],
      metrics: [],
    };
  },
};
```

Then register it in `src/providers/index.ts`:

```ts
export const ADAPTERS: readonly ProviderAdapter[] = [
  // ...
  exampleAdapter,
];
```

Nothing else needs to change. The core never names a provider.

### Adapter rules

- **Never throw for provider-side problems.** Return
  `{ status: "unavailable", configured: true, reason }`. Throw only for bugs.
- **Use `configured: false`** when the user simply has no credential. That hides the
  provider instead of showing a permanent error.
- **Never put a secret in `reason`.** Pass it via `credential.secrets` so
  `fetchJson` can scrub it from error messages.
- **Return `undefined` from `fromResponseHeaders`** when a response carries nothing
  usable — that is normal, not a failure.
- **Read numbers with `asNumber`**, which accepts numeric strings; providers are
  inconsistent about this.

### Passive capture

If a provider reports quota in the headers of ordinary inference responses, implement
`fromResponseHeaders` instead of (or as well as) `query`. It costs no extra request
and updates as the user works. `src/providers/anthropic.ts` is the reference.

## Development

```bash
npm install
npm run typecheck
npm test
```

The test suite runs on plain Node with no test dependencies. It resolves
TypeScript's `.js`-style relative imports through a small hook in `test/` so that
`npm test` works immediately after a clone.

CI runs typecheck and tests on every push and pull request
(`.github/workflows/ci.yml`). Nothing reaches `main` unverified.

## Design notes

- **Why a widget and not a floating overlay?** `tui.showOverlay(..., {
  nonCapturing: true })` would allow a true free-floating panel, but it is
  undocumented and pi marks overlays as experimental. A focus mistake there can steal
  keyboard input from the editor. `ctx.ui.setWidget()` is the stable, documented API
  and can never capture input; the card is right-aligned to approximate corner
  placement without that risk.
- **No runtime dependencies.** Width measurement and truncation are implemented
  locally (`src/ansi.ts`) rather than imported, so installing the package never pulls
  in anything else.
- **Stale data is labelled.** A snapshot older than 15 minutes says so, so cached
  data is never mistaken for live data.

## Security

- Credentials come from pi's own `ctx.modelRegistry.getProviderAuth()` and are
  validated against the adapter's `officialOrigins` before any request. A provider
  pointed at a custom or proxied base URL is reported as unavailable rather than
  having its credential forwarded elsewhere.
- Requests refuse redirects, are size-bounded, time out, and carry no secret in any
  error message.
- Credentials are never logged, cached, or written to the session.
- Like every pi extension, this package runs with your user's privileges. Read the
  source before installing anything that does.

## Releasing

Publishing is tag-driven and refuses to ship a mismatch:

```bash
npm version patch          # or minor / major
git push --follow-tags
```

## License

MIT. See [LICENSE](LICENSE).
