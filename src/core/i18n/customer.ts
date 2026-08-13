// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Customer locale policy (MASTER.md §4.9, §43 C1.16).
//
// A locale is a customer fact, not a property of whichever delivery happens
// to be rendering it. Portal pages, transactional templates and notification
// channels all call this file so they cannot quietly disagree about fallback.
import { eq } from "drizzle-orm";
import type { Tx } from "@/core/service";
import { contacts } from "@/core/contacts/schema";
import { businessProfile } from "@/core/settings/schema";
import { DEFAULT_LOCALE } from "@/core/i18n";

export interface LocalePolicy {
  defaultLocale: string;
  enabledLocales: string[];
}

export interface ResolvedCustomerLocale extends LocalePolicy {
  locale: string;
}

/** Canonical comparison without making callers care about tag casing. */
function canonical(locale: string): string {
  try {
    return Intl.getCanonicalLocales(locale)[0]?.toLowerCase() ?? locale.toLowerCase();
  } catch {
    return locale.toLowerCase();
  }
}

/**
 * Resolve an enabled locale, then the configured default, then the platform
 * default. A regional preference may use the enabled variant of the same
 * language (fr-CA -> fr) but an unrelated, disabled locale never escapes.
 */
export function resolveEnabledLocale(
  preferred: string | null | undefined,
  policy: LocalePolicy,
): string {
  const enabled = policy.enabledLocales.length > 0
    ? policy.enabledLocales
    : [policy.defaultLocale || DEFAULT_LOCALE];
  const exact = preferred
    ? enabled.find((locale) => canonical(locale) === canonical(preferred))
    : undefined;
  if (exact) return exact;

  if (preferred) {
    const language = canonical(preferred).split("-")[0];
    const related = enabled.find(
      (locale) => canonical(locale).split("-")[0] === language,
    );
    if (related) return related;
  }

  return enabled.find(
    (locale) => canonical(locale) === canonical(policy.defaultLocale),
  ) ?? enabled[0] ?? DEFAULT_LOCALE;
}

/** Read the instance policy inside an existing transaction. */
export async function customerLocalePolicy(tx: Tx): Promise<LocalePolicy> {
  const [business] = await tx
    .select({
      defaultLocale: businessProfile.defaultLocale,
      enabledLocales: businessProfile.enabledLocales,
    })
    .from(businessProfile)
    .limit(1);
  return business ?? {
    defaultLocale: DEFAULT_LOCALE,
    enabledLocales: [DEFAULT_LOCALE],
  };
}

/** The policy plus one Contact's enabled preference. */
export async function localeForContact(
  tx: Tx,
  contactId: string,
): Promise<ResolvedCustomerLocale> {
  const [policy, contact] = await Promise.all([
    customerLocalePolicy(tx),
    tx
      .select({ preferredLocale: contacts.preferredLocale })
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1)
      .then((rows) => rows[0]),
  ]);
  return {
    ...policy,
    locale: resolveEnabledLocale(contact?.preferredLocale, policy),
  };
}

/**
 * Resolve a User through the one Contact identity linked to the customer
 * account. Staff have no linked customer Contact and therefore use the
 * business default.
 */
export async function localeForUser(
  tx: Tx,
  userId: string,
): Promise<ResolvedCustomerLocale> {
  const [policy, contact] = await Promise.all([
    customerLocalePolicy(tx),
    tx
      .select({ preferredLocale: contacts.preferredLocale })
      .from(contacts)
      .where(eq(contacts.userId, userId))
      .limit(1)
      .then((rows) => rows[0]),
  ]);
  return {
    ...policy,
    locale: resolveEnabledLocale(contact?.preferredLocale, policy),
  };
}

export type LocaleRecipient =
  | { kind: "user"; id: string }
  | { kind: "contact"; id: string }
  | { kind: "email"; address: string };

/** Locale snapshot for notification/template fanout. */
export async function localeForRecipient(
  tx: Tx,
  recipient: LocaleRecipient,
): Promise<ResolvedCustomerLocale> {
  if (recipient.kind === "contact") return localeForContact(tx, recipient.id);
  if (recipient.kind === "user") return localeForUser(tx, recipient.id);
  const policy = await customerLocalePolicy(tx);
  return { ...policy, locale: resolveEnabledLocale(null, policy) };
}

const NEVER_PREFIX = /^\/(?:admin|login|setup|preview|api|media)(?:\/|$)/;

/** Default locale is unprefixed; every other enabled customer locale is not. */
export function localePath(
  slug: string,
  locale: string,
  defaultLocale: string,
): string {
  const clean = slug.replace(/^\/+|\/+$/g, "");
  const path = clean === "" ? "/" : `/${clean}`;
  return canonical(locale) === canonical(defaultLocale)
    ? path
    : `/${locale}${path === "/" ? "" : path}`;
}

/**
 * Keep an internal customer link in the selected language. External URLs,
 * fragments, mail/phone links, assets and owner-only routes are left alone.
 */
export function localizeCustomerHref(
  href: string,
  locale: string,
  policy: LocalePolicy,
): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const match = /^([^?#]*)([?#].*)?$/.exec(href);
  const path = match?.[1] || "/";
  const suffix = match?.[2] ?? "";
  if (NEVER_PREFIX.test(path)) return href;

  const parts = path.split("/");
  const first = parts[1];
  const isLocale = first
    ? policy.enabledLocales.some((candidate) => canonical(candidate) === canonical(first))
    : false;
  const bare = isLocale ? `/${parts.slice(2).join("/")}` : path;
  const clean = bare === "" ? "/" : bare;
  const localized = localePath(clean, locale, policy.defaultLocale);
  return `${localized}${suffix}`;
}

/** A language's own name, suitable for a chooser people can recognize. */
export function languageName(locale: string): string {
  try {
    const display = new Intl.DisplayNames([locale], { type: "language" });
    const name = display.of(locale);
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : locale;
  } catch {
    return locale;
  }
}
