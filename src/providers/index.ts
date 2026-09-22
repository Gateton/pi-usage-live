// The provider registry — the single place that knows which providers exist.
//
// Adding a provider is meant to be a one-file change: write an adapter under
// providers/ and add it to ADAPTERS below. No core file should ever need editing,
// and no core file should ever name a provider.
import type { ProviderAdapter } from "../types.js";
import { anthropicAdapter } from "./anthropic.js";
import { deepSeekAdapter } from "./deepseek.js";
import { kimiCodingAdapter } from "./kimi-coding.js";
import { createMiniMaxAdapter } from "./minimax.js";
import { createMoonshotAdapter } from "./moonshot.js";
import { openaiCodexAdapter } from "./openai-codex.js";
import { openCodeGoAdapter } from "./opencode-go.js";
import { openRouterAdapter } from "./openrouter.js";
import { createZaiAdapter } from "./zai.js";

export const ADAPTERS: readonly ProviderAdapter[] = [
  anthropicAdapter,
  openaiCodexAdapter,
  openCodeGoAdapter,
  openRouterAdapter,
  deepSeekAdapter,
  // Regional twins share an implementation but never a credential or an origin.
  createMoonshotAdapter("global"),
  createMoonshotAdapter("cn"),
  kimiCodingAdapter,
  createMiniMaxAdapter("global"),
  createMiniMaxAdapter("cn"),
  createZaiAdapter("global"),
  createZaiAdapter("cn"),
];

const BY_ID = new Map(ADAPTERS.map((adapter) => [adapter.id, adapter]));

export function getAdapter(providerId: string | undefined): ProviderAdapter | undefined {
  return providerId === undefined ? undefined : BY_ID.get(providerId);
}

/** Adapters able to poll on a timer (i.e. those exposing a usage endpoint). */
export function pollableAdapters(): readonly ProviderAdapter[] {
  return ADAPTERS.filter((adapter) => adapter.query !== undefined);
}

export function adapterIds(): readonly string[] {
  return ADAPTERS.map((adapter) => adapter.id);
}
