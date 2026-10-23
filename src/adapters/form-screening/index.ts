// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The form-screening category (C3.33, MASTER.md §12, §36).
//
// Freeholder's own honeypot and signed time trap run on every submission
// whatever is configured here. A screening provider is an optional second
// opinion on anonymous public submissions: `FORM_SCREENING_PROVIDER`, default
// `none`, with swappable adapters. Whatever an adapter answers, the caller can
// only *add* a quarantine reason from it (see `@/modules/forms/screening`).
//
// Each adapter sends the minimum its provider's API requires plus the text it
// screens, and the privacy notice beside every form names the provider and
// lists exactly that while the category is on.
import { env } from "@/core/env";
import { assessWithParadise } from "./paradise";
import type { FormScreeningAdapter } from "./types";

export { FORM_SCREENING_PROVIDERS } from "./types";
export type {
  FormScreeningAdapter,
  FormScreeningProviderId,
  ScreeningOutcome,
  ScreeningRequest,
} from "./types";

/** The configured adapter, or null when the category is off. */
export function formScreening(): FormScreeningAdapter | null {
  const current = env();
  // A public playground contacts no outside provider in any category.
  if (current.FREEHOLDER_PLAYGROUND === "1") return null;
  if (current.FORM_SCREENING_PROVIDER !== "paradise") return null;
  if (!current.PARADISEMODERN_API_KEY) return null;
  return {
    id: "paradise",
    displayName: "Paradise Modern",
    sends: ["formRef", "clientIp", "message"],
    assess: assessWithParadise,
  };
}
