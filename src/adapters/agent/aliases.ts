// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Deprecated agent provider names (owner decision 2026-10-22). The one map
// read by `FREEHOLDER_AGENT`, `adapters.agent`, `agents.connect` and stored
// workforce connections: `pm_brain` was the old name of the `paradise`
// provider. Stored rows are never rewritten — aliasing happens on read, so a
// rollback to a build that only knows `pm_brain` still finds the rows saved
// before this change.
export const LEGACY_AGENT_PROVIDER_ALIASES = { pm_brain: "paradise" } as const;

/** The current id for a deprecated provider name; anything else passes through. */
export function normalizeAgentProviderId<T extends string>(value: T): Exclude<T, "pm_brain"> | "paradise" {
  return (value === "pm_brain" ? LEGACY_AGENT_PROVIDER_ALIASES.pm_brain : value) as Exclude<T, "pm_brain"> | "paradise";
}
