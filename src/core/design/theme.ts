// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Light and dark as a platform standard.
//
// Three states, not two. "System" is the default and means *no stored
// preference* — the OS setting decides, and it keeps deciding when the visitor
// changes it later. Storing a resolved value instead would freeze somebody's
// choice at whatever their laptop happened to be doing that afternoon.
//
// The preference lives in a cookie rather than localStorage because every
// public page is server-rendered (§5). A cookie is readable while the HTML is
// being built, so the right theme is in the first byte; localStorage is only
// readable after JavaScript runs, which is what produces the white flash on a
// dark-themed site.

export const THEME_COOKIE = "freeholder_theme";

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export function parseThemePreference(
  value: string | undefined | null,
): ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference)
    ? (value as ThemePreference)
    : "system";
}

/**
 * What to stamp on the root element, or `undefined` to stamp nothing.
 *
 * Absent is meaningful: with no attribute, the `prefers-color-scheme` rules in
 * the token stylesheet apply. The explicit selectors exist to override that in
 * both directions, so a visitor on a dark OS can still choose light.
 */
export function themeAttribute(
  preference: ThemePreference,
): "light" | "dark" | undefined {
  return preference === "system" ? undefined : preference;
}

// The *names* of these preferences are copy, not structure, so they live in
// the message catalogs under `theme.*` and are translated by the routing layer
// (app/themeLabels.ts). A Record of English strings here would be a second
// place user-facing text can hide from the i18n gate.
