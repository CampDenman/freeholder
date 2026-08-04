// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// hreflang (MASTER.md §5, §4.9).
//
// §5 asks for "full hreflang alternates + x-default" on every localized page.
// The word doing the work is *full*: the set has to include the page itself
// and be reciprocal, or search engines ignore it. What it must not include is
// a locale with no translation — advertising a French version that does not
// exist earns duplicate-content problems in two languages instead of one.
import { translatedIds } from "@/core/i18n/service";

const ANONYMOUS = { kind: "anonymous" } as const;

/** Where a page lives in a locale: default unprefixed, others prefixed. */
export function localePath(
  slug: string,
  locale: string,
  defaultLocale: string,
): string {
  const path = slug === "" ? "/" : `/${slug}`;
  return locale === defaultLocale ? path : `/${locale}${path === "/" ? "" : path}`;
}

/** Which of the instance's other locales have a reviewed translation. */
export async function translatedLocales(
  pageId: string,
  business: { defaultLocale: string; enabledLocales: string[] } | null,
): Promise<string[]> {
  if (!business) return [];
  const others = business.enabledLocales.filter(
    (locale) => locale !== business.defaultLocale,
  );
  const found = await Promise.all(
    others.map(async (locale) => {
      const ids = await translatedIds.call(
        { entityType: "page", locale, ids: [pageId] },
        ANONYMOUS,
      );
      return ids.length > 0 ? locale : null;
    }),
  );
  return found.filter((locale): locale is string => locale !== null);
}

export async function alternatesFor(
  pageId: string,
  slug: string,
  origin: string,
  business: { defaultLocale: string; enabledLocales: string[] } | null,
): Promise<Record<string, string> | null> {
  if (!business || business.enabledLocales.length < 2) return null;

  const translated = new Set(await translatedLocales(pageId, business));
  if (translated.size === 0) return null;

  const languages: Record<string, string> = {
    [business.defaultLocale]: `${origin}${localePath(slug, business.defaultLocale, business.defaultLocale)}`,
  };
  for (const locale of translated) {
    languages[locale] = `${origin}${localePath(slug, locale, business.defaultLocale)}`;
  }
  // x-default points at the site's own language: the version to serve somebody
  // whose language nobody here speaks.
  languages["x-default"] = languages[business.defaultLocale]!;
  return languages;
}
