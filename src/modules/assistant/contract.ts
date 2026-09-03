// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The assistant's public vocabulary (C9.21).
//
// Separate from `schema.ts` so a screen can name a provider or an outcome
// without importing a Drizzle table — `app/**` is barred from module schemas
// (§15.5), and a value list is not a database.
export const ASSISTANT_PROVIDERS = ["none", "anthropic", "openai"] as const;
export type AssistantProvider = (typeof ASSISTANT_PROVIDERS)[number];

export const ASSISTANT_SPEND_PERIODS = ["day", "week", "month"] as const;
export type AssistantSpendPeriod = (typeof ASSISTANT_SPEND_PERIODS)[number];

/**
 * Every way one attempted answer can end.
 *
 * Named rather than a boolean because "the assistant did not reply" has half a
 * dozen causes and an owner has to act differently on each: raise a budget,
 * grant a scope, set a key, or nothing at all.
 */
export const ASSISTANT_TURN_OUTCOMES = [
  "answered",
  "refused_scope",
  "refused_spend",
  "refused_rate",
  "refused_conversation_cap",
  "unconfigured",
  "failed",
] as const;
export type AssistantTurnOutcome = (typeof ASSISTANT_TURN_OUTCOMES)[number];
