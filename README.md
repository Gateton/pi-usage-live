<div align="center">
  <img src="https://raw.githubusercontent.com/Gateton/pi-usage-live/main/assets/usage-live.png" alt="pi-usage-live: a bordered usage card in the bottom-right corner of a Pi session, showing OpenCode Go's rolling, weekly and monthly windows with their reset countdowns" width="880">

# pi-usage-live

**See how much of your subscription you have left, live in your terminal, while you work. Claude, ChatGPT Codex, OpenCode Zen, DeepSeek, Kimi, MiniMax, Moonshot, Z.AI and OpenRouter — in one card that never leaves your screen.**

[![npm](https://img.shields.io/npm/v/pi-usage-live?label=npm)](https://www.npmjs.com/package/pi-usage-live)
[![Pi extension](https://img.shields.io/badge/Pi-extension-19c7d4)](https://github.com/earendil-works/pi-coding-agent)
[![Node](https://img.shields.io/badge/node-%3E%3D22-1f8f4d)](package.json)
[![License](https://img.shields.io/badge/license-MIT-f5a623)](LICENSE)

</div>

`pi-usage-live` adds an always-on usage card to Pi:

- **No command to remember.** The card is simply there, docked in the corner, refreshed while you work. You do not have to ask how much budget is left.
- **It follows the model you are using.** The card shows the allowance that applies to your *next* request, so it is always the number that matters. `/usage all` expands it to every provider at once.
- **Free updates where the provider allows it.** Providers that report quota in the headers of responses you were already making cost zero extra requests; only the rest are polled.
- **Claude keeps updating even when you are not using Claude.** Anthropic exposes both a header path and a usage endpoint, and this card uses both, so your Claude budget does not go dark the moment you switch providers.
- **It knows the difference between high and blocked.** Where a provider reports its own severity, the card trusts it over a generic threshold, so a window that is actually stopping you does not look like one that is merely filling up.
- **Stale data says so.** A reading older than fifteen minutes is labelled with its age, so a cached number is never mistaken for a live one.

## Package facts

| Fact | Value |
| --- | --- |
| Package | `pi-usage-live` |
| Version | `0.1.0` |
| Node engine | `>=22` |
| Runtime dependencies | none |
| Pi entrypoints | `./src/index.ts` |
| Providers | 12 |
| Package image | [assets/usage-live.png](https://raw.githubusercontent.com/Gateton/pi-usage-live/main/assets/usage-live.png) |

## Public surfaces

| Surface kind | Count |
| --- | --- |
| command | 1 |
| tool | 0 |
| shortcut | 0 |
| skill | 0 |
| widget | 1 |

**Command**: `/usage`, with the subcommands below.

**Widget**: one card above the editor, right-aligned into the corner, driven by `ctx.ui.setWidget()`. It never takes keyboard focus, so it cannot interfere with the editor.

## Why use it?

| You want to... | Use this package because... |
|---|---|
| Know if you can keep working | The card is on screen at all times, so the answer is one glance away instead of a command. |
| See the allowance for the model you are on | The card follows the active model. Switch from Claude to Codex and the card switches with you. |
| Watch every provider at once | `/usage all` expands the card to every provider you have credentials for. |
| Avoid a surprise mid-task | Where the provider reports severity, a blocking window is coloured as blocking, and its reset countdown is shown in the same row. |
| Pay nothing for the data | Providers that publish quota in response headers are read passively. Nothing extra is sent. |
| Keep your credentials yours | Credentials come from Pi, are only ever sent to the provider's own origin, and never appear in an error message. |

## Install

```bash
# From npm
pi install npm:pi-usage-live

# Project-local
pi install npm:pi-usage-live -l

# From git
pi install git:github.com/Gateton/pi-usage-live

# Local checkout, run from this package directory
pi install .
```

Try it without installing:

```bash
pi -e npm:pi-usage-live
```

Then just work. The card appears above the editor and follows your active model.

## Quick start

1. Install the package and start Pi in any project. A provider you have not logged into is not shown at all — there is no error row for an account you do not have.

2. The card docks in the bottom-right corner and shows the provider behind your current model:

   ```text
                                          ╭──────────────────────────────────────╮
                                          │ OC Go                                │
                                          │ rolling ░░░░░░░░░░░░░░░   2% (4h27m) │
                                          │ wk      ██░░░░░░░░░░░░░  13% (5d4h)  │
                                          │ mo      ███████░░░░░░░░  49% (8d23h) │
                                          ├──────────────────────────────────────┤
                                          │ 3 providers · /usage all             │
                                          ╰──────────────────────────────────────╯
   ```

3. Switch models with `/model` and the card follows. Switch to a provider with no credential and the card falls back to listing what it does have.

4. Expand it when you want the whole picture:

   ```text
   /usage all
   ```

5. Hide it when you want the space back. The choice is remembered:

   ```text
   /usage hide
   ```

## Commands

| Command | Effect |
|---|---|
| `/usage` | Toggle the card |
| `/usage all` | Show every configured provider, not just the current model's |
| `/usage compact` | Back to just the current model's provider |
| `/usage show` / `/usage hide` | Explicitly show or hide, and remember it |
| `/usage align` | Flip the card between the right corner and the left |
| `/usage refresh` | Poll immediately instead of waiting for the interval |
| `/usage reload` | Re-read the config file without restarting Pi |

Visibility and alignment are written to the config file, so they survive a restart.

## Supported providers

| Provider | Provider id | Reported | Source |
|---|---|---|---|
| Anthropic (Claude Max/Pro) | `anthropic` | 5h and 7d windows, plus model-specific weekly windows when the plan has them | Response headers **and** usage endpoint |
| OpenAI Codex (ChatGPT) | `openai-codex` | 5h and 7d windows, plan | Usage endpoint |
| OpenCode Go (Zen) | `opencode-go` | rolling, weekly, monthly | Usage endpoint |
| OpenRouter | `openrouter` | per-key credit limit and spend | Usage endpoint |
| DeepSeek | `deepseek` | API balance per currency | Balance endpoint |
| Moonshot AI | `moonshotai` | API balance in USD | Balance endpoint |
| Moonshot AI China | `moonshotai-cn` | API balance in CNY | Balance endpoint |
| Kimi For Coding | `kimi-coding` | plan request windows | Usage endpoint |
| MiniMax | `minimax` | Token Plan windows | Quota endpoint |
| MiniMax China | `minimax-cn` | Token Plan windows | Quota endpoint |
| Z.AI | `zai` | 5-hour and weekly quota, plan name | Quota endpoint |
| Z.AI China | `zai-coding-cn` | 5-hour and weekly quota, plan name | Quota endpoint |

Regional providers are separate entries with separate credentials and separate origins. They are never substituted for each other: a China key is not sent to the global endpoint, and vice versa.

### Passive and active

**Passive** means the provider reports quota in the headers of responses you were already making. It costs zero extra requests and refreshes as you work.

**Active** means polling the provider's own usage endpoint on a timer.

Anthropic supports both, deliberately:

- Passive capture keeps the numbers live while you are working in Claude, for free.
- The active poll keeps Claude current while you work in *another* provider, and it is the only source that reports the provider's own severity rating.

When both sources have data for one provider they are **merged** by window and metric label, with the fresher value winning. Without that, the sparse passive update would erase windows only the poll knows about. An error, by contrast, replaces outright — an error has to be able to clear stale numbers.

## Configuration

Optional. `~/.pi/agent/pi-usage-live.json`:

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
| `colorMode` | `"provider-severity"` | Trust the provider's own severity, or use pure thresholds |
| `enabledProviders` | `[]` | Allow-list by provider id; empty means all |
| `disabledProviders` | `[]` | Deny-list, applied after the allow-list |
| `targets` | `{}` | Provider-specific selection, e.g. an account for a multi-account provider |

A missing or malformed file falls back to defaults rather than failing, so a bad config can never stop Pi from starting. Unknown keys are preserved when the extension saves a change, so a setting written by a newer version is not discarded by an older one.

`pollIntervalSec` is floored at 30 seconds on purpose: polling a quota endpoint faster than that would risk getting you rate-limited by the very provider you are trying to monitor.

## Privacy and security

- **Credentials come from Pi.** They are resolved through `ctx.modelRegistry.getProviderAuth()` and never stored, cached or written to the session by this package.
- **Origin is checked before anything is sent.** Every adapter declares the provider's official origin, and a resolved credential whose base URL does not match it is reported as unavailable instead of being forwarded. A provider you have pointed at a custom or proxied endpoint never has its credential sent to the official usage API.
- **Errors are scrubbed.** Every value that could be a credential is passed to the fetch layer, which removes it from any message that reaches the screen.
- **Requests refuse redirects.** A redirect could move a credential to another host.
- **Responses are size-bounded and time out**, so a broken endpoint cannot hang a session or exhaust memory.
- **Provider messages are never echoed.** Where a provider returns a human-readable error string, only the numeric code is surfaced, because those strings can contain credential fragments.

Like every Pi extension, this package runs with your user's privileges. Read the source before installing anything that does.

## Architecture

```
src/index.ts          event wiring: session lifecycle, passive capture, command
src/providers/        one adapter per provider, plus the registry
src/auth.ts           credential resolution and origin validation
src/fetch-json.ts     the single HTTP path: redirects, size bounds, timeouts, redaction
src/card.ts           the bordered HUD card component
src/ansi.ts           ANSI-aware width measurement and truncation
src/state.ts          snapshot store, merging, cache persistence
src/poller.ts         self-scheduling active polling
src/config.ts         config file load and save
src/cache.ts          last-known snapshots, so the card is never blank on startup
```

The core never names a provider. Everything it knows about one arrives through `ProviderAdapter`:

```ts
interface ProviderAdapter {
  id: string;
  displayName: string;
  officialOrigins: readonly string[];
  authStyle: "bearer" | "raw" | "oauth-original";
  fromResponseHeaders?(headers): AdapterResult | undefined;
  query?(credential, ctx): Promise<AdapterResult>;
}
```

An adapter never sets its own `providerId`, `displayName` or `capturedAt` — the core stamps those on, so an adapter cannot get them subtly wrong.

## Adding a provider

One file plus one line. Create `src/providers/<id>.ts` exporting a `ProviderAdapter`, then register it in `src/providers/index.ts`. No core file needs editing.

```ts
export const exampleAdapter: ProviderAdapter = {
  id: "example",                      // must match Pi's provider id exactly
  displayName: "Example",
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
    return { status: "ok", windows: [{ label: "5h", usedPercent: clampPercent(used) }], metrics: [] };
  },
};
```

Rules that matter:

- **Never throw for a provider-side problem.** Return `{ status: "unavailable", configured: true, reason }`. Throw only for bugs.
- **Use `configured: false`** when the user simply has no credential. That hides the provider instead of showing a permanent error.
- **Never put a secret in `reason`.** Pass it through `credential.secrets` so the fetch layer can scrub it.
- **Prefer reporting nothing over reporting something wrong.** Every existing adapter returns `unavailable` rather than guessing when a payload does not match the shape it expects. An inverted or invented meter is worse than a missing one.
- **Read numbers with `asNumber`**, which accepts numeric strings. Providers are inconsistent about this.
- **Keep money as strings.** Decimal values from balance endpoints are passed through untouched so no float rounding is introduced.

`src/providers/anthropic.ts` is the reference for a provider with both a passive and an active path. `src/providers/kimi-coding.ts` is the reference for one whose response shape has drifted across versions.

## Development

```bash
npm install
npm run typecheck
npm test
```

The test suite runs on plain Node with no test dependencies, and resolves TypeScript's `.js`-style relative imports through a small hook in `test/`, so `npm test` works immediately after a clone.

CI runs typecheck and tests on every push and pull request.

## Releasing

Publishing is tag-driven:

```bash
npm version patch          # or minor / major
git push --follow-tags
```

The publish workflow refuses to ship when the tag disagrees with `package.json`, or when placeholder text remains in `package.json` or `LICENSE`. It publishes with npm provenance, so a consumer can verify the tarball was built from this repository by this workflow.

## Limitations

- **Several providers use undocumented endpoints.** Kimi, MiniMax and Z.AI are not published API contracts and may change without notice. Their parsers are written defensively: an unrecognised shape reports as unavailable rather than showing a wrong number, so a change costs you a row until the adapter is updated.
- **Z.AI authentication is ambiguous.** Public implementations disagree on whether its quota endpoint wants a `Bearer` prefix or the bare key. The adapter sends the bare key and retries once with the prefix on an auth rejection, rather than picking a side and breaking for half of users.
- **MiniMax's `usage_count` direction has drifted** across versions of its API. An explicit percentage or remaining alias is always preferred, and the ambiguous count is only used when a total is available to sanity check it against.
- **Balance-only providers show no history.** DeepSeek and Moonshot expose a current balance, not spend history, quota windows or reset times, so the card claims none of those for them.
- **GitHub Copilot and xAI are not supported.** Both need the original OAuth credential rather than the short-lived inference token Pi exposes. They are reported as unavailable rather than sent the wrong credential.
- **Gemini is not supported.** No usage endpoint that accepts Pi's resolved credential has been identified.
- **The card cannot show a smooth colour gradient.** Pi's `Theme` exposes `fg`/`bg`/`bold`/`italic`/`strikethrough` but not the resolved colour values, so a gradient would require hardcoding colours and would break every custom theme.
- **Readings are snapshots.** A provider may itself delay or round what it reports, and a window can move between polls.

## Contributing

Keep user-facing claims tied to source. If you change adapters, the merge behaviour, the card or the config, update this README in the same change and run `npm test`.

If a provider does not work for you, the useful report is the provider id, what the card shows, and — where you can share it — the shape of the endpoint's response with the values removed. Adding or fixing a provider is one file under `src/providers/` plus a test.

## License

[MIT](LICENSE)
