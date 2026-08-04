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
import { headers } from "next/headers";
import { DEFAULT_LOCALE, translator, type Translate } from "@/core/i18n";
import { LOCALE_HEADER } from "@/core/http/headers";
import { currentBusiness } from "@/core/settings/read";

/**
 * Memoized for the render pass, so a page, its layout and three nested
 * components asking for the locale is one query rather than five. React's
 * `cache` is per-request, so two visitors never share an answer.
 */
export const getLocale = cache(async (): Promise<string> => {
  const business = await currentBusiness();
  // No profile yet means first boot: the setup wizard runs before there is a
  // business to have a locale, so the platform default carries those screens.
  const fallback = business?.defaultLocale ?? DEFAULT_LOCALE;

  // §4.9's URL strategy: a prefix asked for a locale, and the proxy stripped
  // it. Honoured only if the instance actually publishes it — the edge cannot
  // check that, so this is where an invented `/xx/` prefix stops being a
  // locale and goes back to being an ordinary path (see requestedLocale).
  const asked = (await headers()).get(LOCALE_HEADER);
  if (asked && business?.enabledLocales.includes(asked)) return asked;
  return fallback;
});

/**
 * The locale the URL asked for, whether or not it is published.
 *
 * The catch-all needs the distinction: a prefix for a locale this site does
 * publish means "render in French"; one for a locale it does not means the
 * segment was never a prefix at all, and `/de/about` is a page called
 * `de/about`. Answering that here keeps the rule in one place.
 */
export async function requestedLocale(): Promise<string | null> {
  return (await headers()).get(LOCALE_HEADER);
}

/** The bound `t` for this request. */
export async function getT(): Promise<Translate> {
  return translator(await getLocale());
}
