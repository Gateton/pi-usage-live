# pi-subscription-usage

A jcode-style **always-on** live widget for Pi showing how much of your
Claude Max/Pro, ChatGPT Codex, OpenCode Go, and OpenRouter quota you've used
— right above the editor, updated in real time, no `/usage` needed to see it.

## Why

Pi's built-in footer already shows token/cache/cost/context usage per session.
What it doesn't show is **subscription-window quota** (Claude's rolling 5h/7d
allowance, Codex's ChatGPT rate-limit windows, etc.) — the same thing `jcode
usage` reports. This extension fills that gap as a persistent widget instead
of a one-shot command.

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

- `/usage` — toggle the widget on/off
- `/usage show` / `/usage hide` — explicit show/hide
- `/usage refresh` — force an immediate refresh of the active pollers

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
