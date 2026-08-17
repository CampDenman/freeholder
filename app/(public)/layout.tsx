// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The public shell (MASTER.md §32).
//
// Read what this file does *not* contain: no header markup, no nav, no footer,
// no site structure of any kind. §32 requires exactly that — "the header,
// footer, nav and announcement bar are synced Sections … `app/(public)/
// layout.tsx` is a thin shell that renders the chrome Sections; it contains no
// hardcoded site structure. Menus are rows, not JSX."
//
// So this fetches two rows and renders their block trees. Changing the site's
// header is an UPDATE, live on the next request, with a revision kept — and
// nobody has to touch this file to do it.
import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";
import { PATH_HEADER, REQUEST_TARGET_HEADER } from "@/core/http/headers";
import { renderBlocks } from "@/modules/cms/render";
import {
  ANNOUNCEMENT_KEY,
  FOOTER_KEY,
  HEADER_KEY,
  NAV_KEY,
} from "@/modules/cms/defaults";
import type { BlockNode } from "@/modules/cms/blocks/types";
import { getLocale, getT } from "../i18n";
import { currentBusiness } from "@/core/settings/read";
import { publishedSection } from "@/modules/cms/read";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { currentAnalyticsSettings } from "@/modules/analytics/read";
import {
  ANALYTICS_CONSENT_COOKIE,
  ANON_COOKIE,
  SESSION_COOKIE_NAME,
  parseAnalyticsConsentState,
} from "@/modules/analytics/visitor";
import { AnalyticsRuntime } from "./AnalyticsRuntime";
import { AnalyticsConsentControl } from "./AnalyticsConsentControl";
import { SkipLink } from "@/ui/SkipLink";
import { actorFromToken } from "@/core/http/actor";
import { MagicWand } from "@phosphor-icons/react/dist/ssr";

export const dynamic = "force-dynamic";


export default async function PublicLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [locale, t, business, requestHeaders, cookieJar, analytics] = await Promise.all([
    getLocale(),
    getT(),
    currentBusiness(),
    headers(),
    cookies(),
    currentAnalyticsSettings(),
  ]);
  const consent = parseAnalyticsConsentState(
    cookieJar.get(ANALYTICS_CONSENT_COOKIE)?.value,
  );
  const publicActor = await actorFromToken(
    cookieJar.get(SESSION_COOKIE_NAME)?.value,
  );
  const showBuilder = publicActor.kind === "user" && publicActor.role === "owner";

  const [announcement, header, navigation, footer] = await Promise.all([
    publishedSection(ANNOUNCEMENT_KEY, locale),
    publishedSection(HEADER_KEY, locale),
    publishedSection(NAV_KEY, locale),
    publishedSection(FOOTER_KEY, locale),
  ]);

  // `path` lets a nav block mark the current entry. A layout cannot know which
  // page is rendering inside it, so middleware.ts puts the pathname on a
  // request header and the chrome reads it here — which keeps the nav a server
  // component instead of a client one that exists only to call usePathname().
  const ctx = {
    locale,
    t,
    business: business
      ? {
          name: business.name,
          tagline: business.tagline,
          defaultLocale: business.defaultLocale,
          enabledLocales: business.enabledLocales,
        }
      : null,
    path: requestHeaders.get(PATH_HEADER) ?? "/",
    localizeHref: business
      ? (href: string) => localizeCustomerHref(href, locale, business)
      : undefined,
  };

  const [announcementNodes, headerNodes, navNodes, footerNodes] = await Promise.all([
    announcement ? renderBlocks(announcement.blocks as BlockNode[], ctx) : [],
    header ? renderBlocks(header.blocks as BlockNode[], ctx) : [],
    navigation ? renderBlocks(navigation.blocks as BlockNode[], ctx) : [],
    footer ? renderBlocks(footer.blocks as BlockNode[], ctx) : [],
  ]);

  return (
    <div className="flex min-h-svh flex-col bg-paper">
      <SkipLink>{t("a11y.skipToContent")}</SkipLink>
      {announcementNodes.some(Boolean) ? (
        <div
          role="region"
          aria-label={t("cms.announcement.region")}
          className="bg-accent text-on-accent"
        >
          <div className="mx-auto max-w-3xl px-6 py-2">{announcementNodes}</div>
        </div>
      ) : null}
      {headerNodes.length > 0 || navNodes.length > 0 ? (
        <header className="border-b border-rule bg-surface">
          <div className="mx-auto flex max-w-3xl flex-col gap-3 px-6 py-4">
            {headerNodes}
            {navNodes}
          </div>
        </header>
      ) : null}

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-3xl flex-1 px-6 py-12"
      >
        {children}
      </main>

      {footerNodes.length > 0 ? (
        <footer className="border-t border-rule bg-surface">
          <div className="mx-auto max-w-3xl px-6 py-6 text-sm text-ink-muted">
            {footerNodes}
          </div>
        </footer>
      ) : null}
      <AnalyticsConsentControl
        policy={analytics.consentPolicy}
        state={consent}
        retentionDays={analytics.retentionDays}
        returnTo={requestHeaders.get(REQUEST_TARGET_HEADER) ?? "/"}
        t={t}
      />
      <AnalyticsRuntime
        policy={analytics.consentPolicy}
        state={consent}
        hasIdentity={Boolean(
          cookieJar.get(ANON_COOKIE)?.value &&
          cookieJar.get(SESSION_COOKIE_NAME)?.value
        )}
      />
      {showBuilder ? (
        <a
          href="/admin/builder"
          className="fixed bottom-5 end-5 z-40 inline-flex items-center gap-2 rounded-full border border-accent bg-accent px-4 py-2.5 text-sm font-bold text-on-accent shadow-[0_12px_32px_rgb(0_0_0/0.2)]"
        >
          <MagicWand size={17} weight="fill" />
          {t("builder.publicAffordance")}
        </a>
      ) : null}
    </div>
  );
}
