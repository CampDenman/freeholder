// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The customer portal shell (MASTER.md §4.1, C8.10).
//
// One home for the relationship, so a customer is never asked to keep a
// token-bearing email to find their own quote. The token pages still work —
// somebody who has not signed in can still open the link they were sent — and
// this shell is what a signed-in person gets instead of a scavenger hunt.
//
// `revalidatePath("/portal", "layout")` already existed in the locale action,
// written against a layout that did not. This is that layout.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { getLocale, getT } from "../../i18n";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { currentBusiness } from "@/core/settings/read";
import { SkipLink } from "@/ui/SkipLink";
import { portalSignOutAction } from "../actions";

export const metadata: Metadata = {
  // A portal is a person's own records. It is never a search result.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [business, locale, t, jar] = await Promise.all([
    currentBusiness(),
    getLocale(),
    getT(),
    cookies(),
  ]);
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  // A customer holds no module grants; staff signed into the portal see the
  // same shell, and their admin is elsewhere.
  const signedIn = actor.kind === "user";
  const href = (path: string) =>
    business ? localizeCustomerHref(path, locale, business) : path;

  const links = [
    { path: "/portal", label: t("portal.nav.home") },
    { path: "/portal/profile", label: t("portal.nav.profile") },
    { path: "/portal/privacy", label: t("portal.nav.privacy") },
  ];

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <SkipLink target="main">{t("a11y.skipToContent")}</SkipLink>
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 p-4">
          <p className="font-semibold">{business?.name ?? t("portal.title")}</p>
          {signedIn ? (
            <div className="flex flex-wrap items-center gap-4">
              {/* A real <nav> with a name, because a screen reader user needs
                  to know which of several navigations this is. */}
              <nav aria-label={t("portal.nav.label")}>
                <ul className="flex list-none flex-wrap gap-4 p-0 text-sm">
                  {links.map((link) => (
                    <li key={link.path}>
                      <a href={href(link.path)} className="underline">
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
              <form action={portalSignOutAction}>
                <button type="submit" className="text-sm underline">
                  {t("portal.signOut")}
                </button>
              </form>
            </div>
          ) : (
            <a href={href("/portal/login")} className="text-sm underline">
              {t("portal.signIn")}
            </a>
          )}
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-3xl p-4">
        {children}
      </main>
    </div>
  );
}
