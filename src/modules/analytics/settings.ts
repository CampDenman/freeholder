// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Analytics governance settings (MASTER.md C1.18, §4.7, §36).
import { z } from "zod";
import type { AnalyticsConsentState } from "./visitor";

export const analyticsSettingsSchema = z.object({
  includeBots: z.boolean().default(false),
  consentPolicy: z
    .enum(["privacy_first", "opt_in", "disabled"])
    .default("privacy_first"),
  retentionDays: z.number().int().min(30).max(730).default(180),
});

export type AnalyticsSettings = z.infer<typeof analyticsSettingsSchema>;
export type AnalyticsConsentPolicy = AnalyticsSettings["consentPolicy"];

/**
 * Whether policy permits storing analytics for this visitor.
 *
 * The default policy records deliberately minimal first-party analytics and
 * honours an explicit opt-out. `opt_in` requires an affirmative grant, and
 * `disabled` refuses collection regardless of an old browser choice.
 */
export function analyticsCollectionAllowed(
  policy: AnalyticsConsentPolicy,
  state: AnalyticsConsentState | null,
): boolean {
  if (policy === "disabled") return false;
  if (policy === "opt_in") return state === "granted";
  return state !== "denied" && state !== "disabled";
}

/** Browser state is reconciled after an owner changes the instance policy. */
export function analyticsConsentNeedsSync(
  policy: AnalyticsConsentPolicy,
  state: AnalyticsConsentState | null,
): boolean {
  if (policy === "disabled") return state !== "disabled";
  if (policy === "opt_in") {
    return state !== "granted" && state !== "denied" && state !== "pending";
  }
  return state !== "implicit" && state !== "granted" && state !== "denied";
}
