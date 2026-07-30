// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Resolving *which* locale a render is in (MASTER.md §4.9).
//
// The string layer itself lives in src/core/i18n and knows nothing about
// requests; this is the routing skin's half — the part that has to ask the
// instance what its locale is. It lives in app/ for the same reason theme.ts
// does: src/ stays framework-agnostic (§10).
//
// Today the answer is the business's default locale. The rest of §4.9 arrives
// with the public surface: a URL prefix for non-default locales, and
// `Contact.preferred_locale` for customer-facing pages. Both change this
// function only — every call site already takes whatever it returns.
import { cache } from "react";
import { DEFAULT_LOCALE, translator, type Translate } from "@/core/i18n";
import { getBusiness } from "@/core/settings/service";

const ANONYMOUS = { kind: "anonymous" } as const;

/**
 * Memoized for the render pass, so a page, its layout and three nested
 * components asking for the locale is one query rather than five. React's
 * `cache` is per-request, so two visitors never share an answer.
 */
export const getLocale = cache(async (): Promise<string> => {
  const business = await getBusiness.call({}, ANONYMOUS);
  // No profile yet means first boot: the setup wizard runs before there is a
  // business to have a locale, so the platform default carries those screens.
  return business?.defaultLocale ?? DEFAULT_LOCALE;
});

/** The bound `t` for this request. */
export async function getT(): Promise<Translate> {
  return translator(await getLocale());
}
