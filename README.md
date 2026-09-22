# pi-subscription-usage

A jcode-style **always-on** live widget for Pi showing how much of your
Claude Max/Pro, ChatGPT Codex, OpenCode Go, and OpenRouter quota you've used —
rendered as a compact bordered HUD card anchored in the **bottom-right corner**
of the terminal, above the editor.

```
                                            ╭──────────────────────────────╮
                                            │ Claude                       │
                                            │ 5h  ███████████████ 100%     │
                                            │ 7d  █░░░░░░░░░░░░░░   8%     │
                                            ├──────────────────────────────┤
                                            │ +3 more · /usage all         │
                                            ╰──────────────────────────────╯
```

By default it shows **only the provider backing your current model**, like
jcode. `/usage all` expands it into a full panel with all configured providers.

## Why

Pi's built-in footer already shows token/cache/cost/context usage per session.
What it doesn't show is **subscription-window quota** (Claude's rolling 5h/7d
allowance, Codex's ChatGPT rate-limit windows, etc.) — the same thing `jcode
usage` reports. This extension fills that gap as a persistent card instead
of a one-shot command.

## Visual design

- Bordered box (`╭─╮ │ ╰─╯`) that reads as a HUD panel, not raw log lines.
- 15-cell gradient bar per quota window, colored by severity from the active
theme: **green** < 60%, **yellow** 60–84%, **red** ≥ 85%.
- Window labels aligned per provider, so `rolling` / `wk` / `mo` bars line up.
- Reset countdowns in human units (`3h25m`, `6d7h`), never `151h24m`.
- Right-aligned to the terminal's bottom-right corner, with an automatic
fallback to left alignment when the terminal is too narrow to fit the card
plus a visible gap (a clipped card would be worse than a left-aligned one).
- Theme-aware: colors are read live from `ctx.ui.theme` at render time, so
switching themes in `/settings` is picked up without a reload.

## How each provider updates

| Provider | Mechanism | Cost |
|---|---|---|
| **Anthropic (Claude)** | Passive — parsed from `anthropic-ratelimit-unified-*` response headers on every real request | Free, zero extra calls |
| **OpenAI Codex (ChatGPT)** | Active poll, `GET https://chatgpt.com/backend-api/wham/usage` | Every 5 min |
| **OpenCode Go** | Active poll, `GET https://opencode.ai/zen/go/v1/usage` | Every 5 min |
| **OpenRouter** | Active poll, `GET https://openrouter.ai/api/v1/key` | Every 5 min |

Active pollers back off to a 30s retry on real errors (not on "provider not
configured", which is silently skipped). All credentials are resolved through
Pi's documented `ctx.modelRegistry.getProviderAuth(id)` API and are validated
against each provider's one official origin before any request is sent —
never forwarded to a custom/proxy base URL.

A provider with no active credentials on this machine simply doesn't appear
in the widget; nothing is shown as a placeholder.

## Install

Already wired into this machine's `~/.pi/agent/settings.json` → `packages`.
For a fresh machine:

```json
{
  "packages": ["/path/to/pi-subscription-usage"]
}
```

or for a quick local test without installing:

```bash
pi -e ./src/index.ts
```

## Commands

| Command | Effect |
|---|---|
| `/usage` | Toggle the widget on/off |
| `/usage show` / `/usage hide` | Explicit show / hide |
| `/usage all` (or `expand`) | Show every configured provider at once |
| `/usage compact` (or `collapse`) | Back to just the current model's provider |
| `/usage align` | Flip between right-corner and left alignment |
| `/usage align left` / `right` | Set alignment explicitly |
| `/usage refresh` | Force an immediate refresh of the active pollers |

## Design notes

- **Why a widget and not a floating overlay?** `tui.showOverlay(..., {
  nonCapturing: true })` would allow a true free-floating corner panel, but it is
  undocumented and Pi marks overlays as experimental. A focus-handling mistake
  there can steal keyboard input from the editor. `ctx.ui.setWidget()` is the
  stable, documented API and can never capture input. The card is right-aligned
  to approximate the corner placement without that risk.
- **Why only four providers?** These are exactly the ones authenticated on the
  target machine. Adding another is one file under `src/providers/` plus one
  line in `ALL_PROVIDER_IDS`.
- **Security.** Credentials come from Pi's own
  `ctx.modelRegistry.getProviderAuth(id)` and are validated against each
  provider's single official origin before any request; a custom/proxy base URL
  for that provider id causes the row to be reported unavailable rather than
  having its credential forwarded elsewhere. Requests reject redirects, are
  bounded in size, time out, and are never logged.

## Persistence

Last-known snapshot per provider is cached at
`~/.pi/agent/subscription-usage.json` so the widget shows real data
immediately on startup instead of being blank until the first refresh
completes.

## Scope

Out of scope by design (kept in `@narumitw/pi-usage` if you still want them):
Fireworks, Baseten, DeepSeek, MiniMax, Moonshot, GitHub Copilot, Kimi, Z.AI,
xAI, Vercel AI Gateway usage, and the Codex Fast-mode `/fast` toggle. This
extension covers exactly the subscriptions this machine actually
authenticates with.
