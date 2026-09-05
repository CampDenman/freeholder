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
import {
  CSP_NONCE_HEADER,
  THIRD_PARTY_CREATIVE_CONSENT_COOKIE,
  parseThirdPartyCreativeConsent,
} from "@/core/http/csp";
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
import { assignmentsFor } from "@/modules/cms/experiments";
import { ANON_HEADER, SESSION_HEADER } from "@/modules/analytics/visitor";
import { recordExperimentImpressions } from "@/modules/analytics/service";
import { PopupMount } from "@/modules/popups/mount";
import { POPUP_TALLY_COOKIE } from "@/modules/popups/tally";
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
  const visitorId = requestHeaders.get(ANON_HEADER);
  const experimentAssignments = assignmentsFor(
    [
      ...((announcement?.blocks as BlockNode[] | undefined) ?? []),
      ...((header?.blocks as BlockNode[] | undefined) ?? []),
      ...((navigation?.blocks as BlockNode[] | undefined) ?? []),
      ...((footer?.blocks as BlockNode[] | undefined) ?? []),
    ],
    visitorId,
  );
  if (visitorId && Object.keys(experimentAssignments).length > 0) {
    await recordExperimentImpressions.call(
      {
        anonId: visitorId,
        sessionId: requestHeaders.get(SESSION_HEADER) ?? visitorId,
        path: requestHeaders.get(PATH_HEADER) ?? "/",
        locale,
        assignments: experimentAssignments,
      },
      { kind: "anonymous" },
    ).catch(() => undefined);
  }
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
    visitorId,
    experimentAssignments,
    thirdPartyConsent: parseThirdPartyCreativeConsent(
      cookieJar.get(THIRD_PARTY_CREATIVE_CONSENT_COOKIE)?.value,
    ),
    cspNonce: requestHeaders.get(CSP_NONCE_HEADER) ?? undefined,
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
          <div className="mx-auto px-[var(--fh-gutter,1.5rem)] py-2" style={{ maxWidth: "var(--fh-measure, 48rem)" }}>{announcementNodes}</div>
        </div>
      ) : null}
      {headerNodes.length > 0 || navNodes.length > 0 ? (
        <header className="border-b border-rule bg-surface">
          <div className="mx-auto flex w-full flex-col gap-3 px-[var(--fh-gutter,1.5rem)] py-4" style={{ maxWidth: "var(--fh-measure, 48rem)" }}>
            {headerNodes}
            {navNodes}
          </div>
        </header>
      ) : null}

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full flex-1 px-[var(--fh-gutter,1.5rem)] py-12"
        style={{ maxWidth: "var(--fh-measure, 48rem)" }}
      >
        {children}
      </main>

      {footerNodes.length > 0 ? (
        <footer className="border-t border-rule bg-surface">
          <div className="mx-auto px-[var(--fh-gutter,1.5rem)] py-6 text-sm text-ink-muted" style={{ maxWidth: "var(--fh-measure, 48rem)" }}>
            {footerNodes}
          </div>
        </footer>
      ) : null}

      {/*
        Colophon. Deliberately quiet: Freeholder is a demonstration of what
        WeVibeSites builds, so the phone number is here for anyone who wants it
        rather than pushed as a call-to-action the way it is on wevibesites.com.
        Rendered outside the CMS footer above so it does not depend on a
        Section existing, and so an editor cannot remove the attribution.
      */}
      <div className="border-t border-rule bg-surface">
        <div
          className="mx-auto flex flex-col gap-1 px-[var(--fh-gutter,1.5rem)] py-4 text-xs text-ink-muted sm:flex-row sm:items-center sm:justify-between"
          style={{ maxWidth: "var(--fh-measure, 48rem)" }}
        >
          <span>
            {t("colophon.builtBy")}{" "}
            <a
              href="https://wevibesites.com"
              className="underline underline-offset-2 hover:text-ink"
            >
              {t("colophon.builder")}
            </a>
          </span>
          <a
            href="tel:+16393834662"
            className="tabular-nums hover:text-ink"
            aria-label={t("colophon.callAria")}
          >
            {t("colophon.phone")}
          </a>
        </div>
      </div>
      {/*
        The popup surface (C9.30). Last in the document because both of its
        non-modal shapes are fixed to the bottom of the viewport, so this is
        where the tab order should meet them; the modal shape goes to the
        browser's top layer and does not care where it was written.

        The visitor's cap tally is handed over as the raw cookie value. The
        service owns that encoding — the shell's job is to carry it, not to
        understand it.
      */}
      <PopupMount
        path={ctx.path}
        locale={locale}
        t={t}
        business={ctx.business}
        localizeHref={ctx.localizeHref}
        visitorKey={visitorId ?? cookieJar.get(ANON_COOKIE)?.value ?? null}
        tally={cookieJar.get(POPUP_TALLY_COOKIE)?.value ?? null}
        actor={publicActor}
      />
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
          className="fixed bottom-5 end-5 z-40 inline-flex items-center gap-2 rounded-full border border-accent bg-accent px-4 py-2.5 text-sm font-bold text-on-accent shadow-float"
        >
          <MagicWand size={17} weight="fill" />
          {t("builder.publicAffordance")}
        </a>
      ) : null}
    </div>
  );
}
