// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Turning the owner's provider/model/key choice into something that can be
// asked a question (MASTER.md §31, §17, C9.21).
//
// §31: "LLM selection follows the adapter pattern (`adapters/ai`): owner picks
// provider + model + key in admin … with a 'none' fallback that simply hides
// the assistant."
//
// The key is the delicate part, and this file deliberately does the same thing
// `adapters/agent/workforce.ts` already does for managed agents: the database
// stores the *name* of an environment variable, and the value is read from the
// environment at the moment it is needed. §17 puts secrets in the environment
// and configuration in the database, and this keeps that line intact — a
// database dump of a Freeholder instance contains no model key, no read
// service has to remember to omit a column, and the audit redactor never has
// to catch one. On a platform whose Secrets pane *is* the environment, an
// owner pastes their key there and types its name here, which is one step
// either way.
//
// The cost of the indirection is honest and worth naming: an owner who cannot
// set an environment variable on their host cannot configure the assistant.
// The admin screen therefore says exactly which variable it is looking for and
// whether it found it, rather than failing at the first visitor question.
import { env } from "@/core/env";
import { createAnthropicAi, createOpenAiAi, type AiAdapter } from "@/adapters/ai";
import type { AssistantProvider } from "./contract";
import type { AssistantSettings } from "./schema";

/** The conventional variable per provider, when the owner names none. */
const DEFAULT_CREDENTIAL_REF: Record<Exclude<AssistantProvider, "none">, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

export function credentialRefFor(settings: {
  provider: AssistantProvider;
  credentialRef: string | null;
}): string | null {
  if (settings.provider === "none") return null;
  return settings.credentialRef?.trim() || DEFAULT_CREDENTIAL_REF[settings.provider];
}

/**
 * The key behind a ref.
 *
 * `process.env` directly, because the ref is owner data and so cannot be a
 * member of the typed env schema; the typed view is consulted second for the
 * names it does normalize.
 */
export function credentialValue(ref: string | null): string | undefined {
  if (!ref) return undefined;
  const raw = process.env[ref]?.trim();
  if (raw) return raw;
  const typed = env() as Record<string, unknown>;
  const fallback = typed[ref];
  return typeof fallback === "string" && fallback.trim() ? fallback.trim() : undefined;
}

/** Whether a key is present, without ever handing the key back. */
export function credentialPresent(settings: {
  provider: AssistantProvider;
  credentialRef: string | null;
}): boolean {
  return credentialValue(credentialRefFor(settings)) !== undefined;
}

export type AdapterResolution =
  | { adapter: AiAdapter }
  | { unconfigured: string };

/**
 * The adapter for these settings, or a plain-English reason there is none.
 *
 * A reason rather than a throw: "the owner has not finished setting this up"
 * is an ordinary state of an optional module, and it has to be recordable —
 * a throw here would roll back the row that says so.
 */
export function assistantAdapter(settings: AssistantSettings): AdapterResolution {
  if (settings.provider === "none") {
    return { unconfigured: "No model provider is chosen for the assistant." };
  }
  if (!settings.model?.trim()) {
    return { unconfigured: "No model is chosen for the assistant." };
  }
  const ref = credentialRefFor(settings);
  const apiKey = credentialValue(ref);
  if (!apiKey) {
    return {
      unconfigured: `The assistant is switched on, but ${ref} is not set in this deployment's environment.`,
    };
  }
  const options = { apiKey, model: settings.model, baseUrl: settings.baseUrl };
  return {
    adapter:
      settings.provider === "anthropic"
        ? createAnthropicAi(options)
        : createOpenAiAi(options),
  };
}
