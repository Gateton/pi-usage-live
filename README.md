<div align="center">
  <img src="https://raw.githubusercontent.com/Gateton/pi-usage-live/main/assets/usage-live.png" alt="A Pi session with pi-usage-live's usage card docked in the bottom-right corner, showing OpenCode Go's rolling, weekly and monthly quota windows with their reset countdowns" width="880">

# pi-usage-live

**Your subscription allowance, always on screen.**

Claude, ChatGPT Codex, OpenCode Zen, DeepSeek, Kimi, MiniMax, Moonshot, Z.AI and OpenRouter — read live while you work, without asking.

[![npm](https://img.shields.io/npm/v/pi-usage-live?label=npm)](https://www.npmjs.com/package/pi-usage-live)
[![Pi extension](https://img.shields.io/badge/Pi-extension-19c7d4)](https://github.com/earendil-works/pi-coding-agent)
[![Node](https://img.shields.io/badge/node-%3E%3D22-1f8f4d)](package.json)
[![License](https://img.shields.io/badge/license-MIT-f5a623)](LICENSE)

</div>

---

`pi-usage-live` adds a usage card to Pi that is simply *there*. No command to remember, no dashboard to open: the card docks in the corner, follows the model you are actually using, and keeps itself current while you work.

<img src="https://raw.githubusercontent.com/Gateton/pi-usage-live/main/assets/usage-card.png" alt="Close-up of the usage card: a bordered panel titled OC Go, with three labelled rows — rolling at 2%, wk at 13% and mo at 49% — each drawn as a bar with its percentage and reset countdown right-aligned" width="700">

## Highlights

- **Zero commands.** The number you need is on screen before you think to ask for it. `/usage all` expands the card when you want the whole picture.
- **It follows your model.** The card shows the allowance behind your *next* request, so it is always the number that matters. Switch providers and the card switches with you.
- **Free where the provider allows it.** Providers that publish quota in the headers of responses you were already making are read passively, at no extra request cost. Only the rest are polled.
- **Claude stays live even when you leave Claude.** Anthropic exposes both a header path and a usage endpoint; the card uses both, so your Claude budget does not go dark the moment you switch providers.
- **It distinguishes *high* from *blocked*.** Where a provider reports its own severity, that rating is trusted over a generic threshold — a window that is actually stopping you does not look like one that is merely filling up.
- **Stale data announces itself.** A reading older than fifteen minutes is labelled with its age, so a cached number is never mistaken for a live one.

## Install

```bash
pi install npm:pi-usage-live
```

Other sources:

```bash
pi install npm:pi-usage-live -l           # project-local
pi install git:github.com/Gateton/pi-usage-live
pi install .                              # from a local checkout
pi -e npm:pi-usage-live                   # try it without installing
```

Then just work. A provider you have not logged into is never shown — there is no error row for an account you do not have.

## Quick start

1. **Start Pi.** The card appears above the editor, docked in the bottom-right corner.

2. **Watch it follow you.** The card tracks the provider behind your active model. Change models with `/model` and the card changes with you.

3. **Expand it when you want everything:**

   ```text
   /usage all
   ```

   <img src="https://raw.githubusercontent.com/Gateton/pi-usage-live/main/assets/usage-all.png" alt="The usage card expanded with /usage all: three stacked panels — Claude at 100% for its 5-hour window and 8% weekly, Codex at 17% and 3% with its plus plan, and OC Go at 3%, 14% and 49%. Claude's exhausted window is drawn in the theme's error colour." width="620">

   Every provider you have credentials for, each with its own windows, percentages and reset countdowns. Claude's exhausted 5-hour window is drawn in the theme's error colour, so a blocking limit is visible without reading the number.

4. **Hide it when you want the space back.** The choice is remembered across restarts:

   ```text
   /usage hide
   ```

## Commands

| Command | Effect |
|---|---|
| `/usage` | Toggle the card |
| `/usage all` | Every configured provider, not just the current model's |
| `/usage compact` | Back to just the current model's provider |
| `/usage show` · `/usage hide` | Show or hide explicitly, and remember it |
| `/usage align` | Flip the card between the right corner and the left |
| `/usage refresh` | Poll now instead of waiting for the interval |
| `/usage reload` | Re-read the config file without restarting Pi |

## Supported providers

| Provider | id | Reported | Source |
|---|---|---|---|
| Anthropic (Claude Max/Pro) | `anthropic` | 5h and 7d windows, plus model-specific weekly windows when the plan has them | Headers **and** endpoint |
| OpenAI Codex (ChatGPT) | `openai-codex` | 5h and 7d windows, plan | Endpoint |
| OpenCode Go (Zen) | `opencode-go` | rolling, weekly, monthly | Endpoint |
| OpenRouter | `openrouter` | per-key credit limit and spend | Endpoint |
| DeepSeek | `deepseek` | API balance per currency | Balance endpoint |
| Moonshot AI | `moonshotai` | API balance in USD | Balance endpoint |
| Moonshot AI China | `moonshotai-cn` | API balance in CNY | Balance endpoint |
| Kimi For Coding | `kimi-coding` | plan request windows | Endpoint |
| MiniMax | `minimax` | Token Plan windows | Quota endpoint |
| MiniMax China | `minimax-cn` | Token Plan windows | Quota endpoint |
| Z.AI | `zai` | 5-hour and weekly quota, plan name | Quota endpoint |
| Z.AI China | `zai-coding-cn` | 5-hour and weekly quota, plan name | Quota endpoint |

Regional providers are separate entries with separate credentials and separate origins. They are never substituted for one another: a China key is not sent to a global endpoint, and vice versa.

### Passive and active

**Passive** means the provider reports quota in the headers of responses you were already making. It costs zero extra requests and refreshes as you work.

**Active** means polling the provider's own usage endpoint on a timer.

Anthropic supports both, deliberately. Passive capture keeps the numbers live while you are working in Claude, for free. The active poll keeps Claude current while you work in *another* provider, and it is the only source that reports the provider's own severity rating.

When both sources have data for one provider they are **merged** by window and metric label, with the fresher value winning — otherwise the sparse passive update would erase windows only the poll knows about. An error replaces outright, because an error has to be able to clear stale numbers.

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

A missing or malformed file falls back to defaults rather than failing, so a bad config can never stop Pi from starting. Unknown keys survive a save, so a setting written by a newer version is not discarded by an older one.

`pollIntervalSec` is floored at 30 seconds on purpose: polling a quota endpoint faster than that risks getting you rate-limited by the very provider you are trying to monitor.

## Privacy and security

- **Credentials come from Pi.** They are resolved through `ctx.modelRegistry.getProviderAuth()` and are never stored, cached or written into the session by this package.
- **Origin is checked before anything is sent.** Each adapter declares its provider's official origin; a credential whose base URL does not match is reported as unavailable rather than forwarded. A provider you have pointed at a custom or proxied endpoint never has its credential sent to the official usage API.
- **Errors are scrubbed.** Every value that could be a credential is handed to the fetch layer, which strips it from any message that reaches the screen.
- **Redirects are refused**, because a redirect could move a credential to another host.
- **Responses are size-bounded and time out**, so a broken endpoint cannot hang a session or exhaust memory.
- **Provider messages are never echoed.** Where a provider returns a human-readable error string, only its numeric code is surfaced — those strings can contain credential fragments.

As with every Pi extension, this package runs with your user's privileges. Read the source before installing anything that does.

## Architecture

```
src/index.ts          event wiring: session lifecycle, passive capture, command
src/providers/        one adapter per provider, plus the registry
src/auth.ts           credential resolution and origin validation
src/fetch-json.ts     the single HTTP path: redirects, bounds, timeouts, redaction
src/card.ts           the bordered HUD card component
src/ansi.ts           ANSI-aware width measurement and truncation
src/state.ts          snapshot store, source merging, cache persistence
src/poller.ts         self-scheduling active polling
src/config.ts         config load and save
src/cache.ts          last-known snapshots, so the card is never blank on startup
```

The core never names a provider. Everything it knows about one arrives through `ProviderAdapter`:

```ts
interface ProviderAdapter {
  id: string;                          // must match Pi's provider id
  displayName: string;
  officialOrigins: readonly string[];
  authStyle: "bearer" | "raw" | "oauth-original";
  fromResponseHeaders?(headers): AdapterResult | undefined;   // passive
  query?(credential, ctx): Promise<AdapterResult>;            // active
}
```

An adapter never sets its own `providerId`, `displayName` or `capturedAt` — the core stamps those on, so an adapter cannot get them subtly wrong.

## Adding a provider

One file and one line. Create `src/providers/<id>.ts` exporting a `ProviderAdapter`, then register it in `src/providers/index.ts`. No core file needs editing.

```ts
export const exampleAdapter: ProviderAdapter = {
  id: "example",
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

The rules that matter:

| Rule | Why |
|---|---|
| Never throw for a provider-side problem — return `unavailable` | A thrown error reaches the model and the session; a usage meter is not worth that |
| Use `configured: false` when the user simply has no credential | That hides the provider instead of showing a permanent error row |
| Never put a secret in `reason` — pass it via `credential.secrets` | The fetch layer scrubs it from anything that reaches the screen |
| **Prefer reporting nothing over reporting something wrong** | Every adapter returns `unavailable` rather than guessing at an unfamiliar shape. An inverted or invented meter is worse than a missing one |
| Read numbers with `asNumber` | Providers are inconsistent about numeric strings |
| Keep money as strings | Decimal values from balance endpoints pass through untouched, so no float rounding is introduced |

`src/providers/anthropic.ts` is the reference for a provider with both a passive and an active path. `src/providers/kimi-coding.ts` is the reference for one whose response shape has drifted across versions.

## Development

```bash
npm install
npm run typecheck
npm test
```

The suite runs on plain Node with no test dependencies, and resolves TypeScript's `.js`-style relative imports through a small hook in `test/`, so `npm test` works immediately after a clone.

CI runs typecheck and tests on every push and pull request.

## Releasing

Publishing is tag-driven:

```bash
npm version patch          # or minor / major
git push --follow-tags
```

The publish workflow refuses to ship when the tag disagrees with `package.json`, or when placeholder text remains in `package.json` or `LICENSE`. It publishes with npm provenance, so a consumer can verify the tarball was built from this repository by this workflow.

## Limitations

- **Several providers use undocumented endpoints.** Kimi, MiniMax and Z.AI are not published API contracts and may change without notice. Their parsers are written defensively, so an unrecognised shape reports as unavailable rather than showing a wrong number — a change costs you a row until the adapter is updated.
- **Z.AI authentication is ambiguous.** Public implementations disagree on whether its quota endpoint wants a `Bearer` prefix or the bare key. The adapter sends the bare key and retries once with the prefix on an auth rejection, rather than picking a side and breaking for half of users.
- **MiniMax's `usage_count` direction has drifted** across versions of its API. An explicit percentage or remaining alias is always preferred; the ambiguous count is used only when a total is available to sanity check it against.
- **Balance-only providers show no history.** DeepSeek and Moonshot expose a current balance, not spend history, quota windows or reset times, so none of those are claimed for them.
- **GitHub Copilot and xAI are not supported.** Both require the original OAuth credential rather than the short-lived inference token Pi exposes. They are reported as unavailable rather than sent the wrong credential.
- **Gemini is not supported.** No usage endpoint that accepts Pi's resolved credential has been identified.
- **The card cannot render a smooth colour gradient.** Pi's `Theme` exposes `fg`/`bg`/`bold`/`italic`/`strikethrough` but not the resolved colour values, so a gradient would require hardcoding colours and would break every custom theme.
- **Readings are snapshots.** A provider may itself delay or round what it reports, and a window can move between polls.

## Contributing

Keep user-facing claims tied to source. If you change adapters, the merge behaviour, the card or the config, update this README in the same change and run `npm test`.

If a provider does not work for you, the useful report is the provider id, what the card shows, and — where you can share it — the shape of the endpoint's response with the values removed. Adding or fixing a provider is one file under `src/providers/` plus a test.

## License

[MIT](LICENSE)
