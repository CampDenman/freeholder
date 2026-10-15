// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0

import { AdapterRegistry } from "../registry";
import { createAnthropicAi } from "./anthropic";
import { createNoAi } from "./none";
import { createOpenAiAi } from "./openai";
import { createPmBrainAi } from "./pm-brain";
import type { AiAdapter } from "./types";

export * from "./types";
export { createNoAi } from "./none";
export { createAnthropicAi } from "./anthropic";
export { createOpenAiAi } from "./openai";
export { createPmBrainAi } from "./pm-brain";

/**
 * The instance-wide registry, keyed the way `freeholder.config.ts` names
 * providers, so `adapters.ai: "anthropic"` resolves to something rather than
 * throwing and being caught as "no adapter installed".
 *
 * These entries read the conventional environment variable once, at load,
 * which is what makes them *instance* adapters: one key, chosen by whoever
 * deployed the box, for background work like drafting translations.
 *
 * The front-site assistant does not use them. It builds its own adapter from
 * the provider, model and credential an owner chose in admin (§31), because
 * that choice belongs to the feature and has to be changeable without a
 * redeploy — and because the assistant meters what it spends, which only makes
 * sense against a configuration it can see.
 */
export const aiAdapters = new AdapterRegistry<AiAdapter>("ai", [
  createNoAi(),
  createAnthropicAi({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL ?? null,
  }),
  createOpenAiAi({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL ?? null,
    baseUrl: process.env.OPENAI_BASE_URL ?? null,
  }),
  // The billing project and fallback policy are read per call, so the env
  // parse they need never runs at import.
  createPmBrainAi({
    apiKey: process.env.PARADISEMODERN_API_KEY,
    model: process.env.PARADISEMODERN_BRAIN_MODEL ?? null,
    baseUrl: process.env.PARADISEMODERN_URL ?? null,
  }),
]);
