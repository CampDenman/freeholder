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
  "refused_topic",
  "refused_invention",
  "unconfigured",
  "failed",
] as const;
export type AssistantTurnOutcome = (typeof ASSISTANT_TURN_OUTCOMES)[number];

/** Tone is a setting, not a prompt the model is trusted to obey (C9.23). */
export const ASSISTANT_TONES = ["professional", "friendly", "brief"] as const;
export type AssistantTone = (typeof ASSISTANT_TONES)[number];

export const KNOWLEDGE_KINDS = ["qa", "fact", "policy"] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

export const GAP_REASONS = ["unknown", "invented"] as const;
export type GapReason = (typeof GAP_REASONS)[number];

export const GAP_STATUSES = ["open", "saved", "dismissed"] as const;
export type GapStatus = (typeof GAP_STATUSES)[number];

export const CHUNK_SOURCES = ["page", "help", "product", "location", "knowledge"] as const;
export type ChunkSource = (typeof CHUNK_SOURCES)[number];
