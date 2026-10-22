// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The admin shell (MASTER.md §10). One guard, one nav, one header — every
// screen under /admin inherits all three, so no individual page can forget to
// check who is asking.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { ThemeToggle } from "@/ui/ThemeToggle";
import { readThemePreference, setThemeAction } from "../../theme";
import { getT } from "../../i18n";
import { themeLabels } from "../../themeLabels";
import { requireStaffActor } from "./guard";
import { AdminNav, type AdminNavLabels } from "./AdminNav";
import { SignOutButton } from "./SignOutButton";
import { currentBusiness } from "@/core/settings/read";
import { unreadNotificationCount } from "@/core/notifications/service";
import { Bell } from "@phosphor-icons/react/dist/ssr";
import { SkipLink } from "@/ui/SkipLink";
import { listGuidanceContexts } from "@/core/guidance/service";
import { AdminGuidanceHelp } from "./AdminGuidanceHelp";
import { PLATFORM_VERSION } from "@/core/platform";
import { PATH_HEADER } from "@/core/http/headers";
import type { Translate } from "@/core/i18n";
import { adminScreenLabel } from "./adminTitle";

export const dynamic = "force-dynamic";

/** Built-in roles with a human name; a custom role shows the name it was given. */
const ROLE_NAMES = new Set([
  "owner",
  "administrator",
  "editor",
  "bookkeeper",
  "service-provider",
  "staff",
  "playground",
]);

function navLabels(t: Translate): AdminNavLabels {
  return {
    region: t("admin.nav.label"),
    overview: t("admin.nav.overview"),
    search: t("admin.nav.search"),
    briefing: t("briefing.title"),
    guidance: t("guidance.allTitle"),
    notifications: t("notifications.title"),
    pages: t("admin.nav.pages"),
    sections: t("admin.nav.sections"),
    templates: t("admin.nav.templates"),
    design: t("admin.nav.design"),
    media: t("admin.nav.media"),
    forms: t("forms.title"),
    assessments: t("assessments.title"),
    facts: t("facts.title"),
    calculators: t("calculators.title"),
    traffic: t("analytics.title"),
    reports: t("reports.title"),
    subscriptions: t("subscriptions.title"),
    access: t("entitlements.title"),
    paywalls: t("paywalls.title"),
    experiments: t("experiments.title"),
    health: t("doctor.title"),
    updates: t("updates.title"),
    jobs: t("jobs.title"),
    contacts: t("admin.nav.contacts"),
    locations: t("admin.nav.locations"),
    translations: t("admin.nav.translations"),
    settings: t("admin.nav.settings"),
    retention: t("admin.nav.retention"),
    redirects: t("seo.redirects.title"),
    roles: t("admin.nav.roles"),
    invitations: t("admin.nav.invitations"),
    builder: t("admin.nav.builder"),
    demos: t("admin.nav.demos"),
    invoices: t("invoices.title"),
    payments: t("payments.title"),
    pos: t("pos.title"),
    products: t("catalog.title"),
    collections: t("admin.nav.collections"),
    prices: t("catalog.prices.listsTitle"),
    inventory: t("catalog.inventory.title"),
    procurement: t("catalog.procure.title"),
    shipping: t("catalog.shipping.title"),
    carts: t("catalog.carts.title"),
    orders: t("catalog.orders.title"),
    fulfillment: t("catalog.fulfill.title"),
    returns: t("catalog.returns.title"),
    promotions: t("catalog.promo.title"),
    calendar: t("calendar.title"),
    calendars: t("calendars.title"),
    appointments: t("appointments.title"),
    pipeline: t("pipeline.title"),
    tasks: t("tasks.title"),
    segments: t("segments.title"),
    scoring: t("scoring.title"),
    referrals: t("referrals.title"),
    ads: t("ads.title"),
    assistant: t("assistant.title"),
    social: t("social.title"),
    sharing: t("share.title"),
    popups: t("popups.title"),
    automations: t("automations.title"),
    documents: t("documents.title"),
    loyalty: t("loyalty.title"),
    gifts: t("gifts.title"),
    printOnDemand: t("pod.title"),
    community: t("community.title"),
    members: t("members.admin.title"),
    voiceVideo: t("voiceVideo.title"),
    marketplace: t("marketplace.title"),
    inbox: t("inbox.title"),
    messaging: t("messaging.title"),
    projects: t("projects.title"),
    galleries: t("galleries.title"),
    reviews: t("reviews.title"),
    time: t("time.title"),
    quotes: t("quotes.title"),
    agreements: t("agreements.title"),
    hire: t("hire.title"),
    events: t("events.title"),
    newsletters: t("newsletters.title"),
    contribute: t("contribute.title"),
    plugins: t("plugins.title"),
    imports: t("imports.title"),
    work: t("work.title"),
  };
}

/**
 * §5: admin is noindexed. It is behind auth as well, but robots directives
 * cost nothing and a crawler that finds a link should not try.
 *
 * Each screen is titled by its own name ("Products — Aurora Coast"), not one
 * title for the whole admin: the title is what a screen reader announces on
 * arrival and what a tab strip shows, and twenty identical tabs say nothing.
 */
export async function generateMetadata(): Promise<Metadata> {
  const [business, t, requestHeaders] = await Promise.all([
    currentBusiness(),
    getT(),
    headers(),
  ]);
  const site = business?.name ?? t("common.appName");
  const screen = adminScreenLabel(
    requestHeaders.get(PATH_HEADER) ?? "/admin",
    navLabels(t),
  );
  return {
    title: `${screen ?? t("admin.title")} — ${site}`,
    robots: { index: false, follow: false },
  };
}


export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const actor = await requireStaffActor();
  const [business, theme, t, unread, guidanceContexts] = await Promise.all([
    currentBusiness(),
    readThemePreference(),
    getT(),
    unreadNotificationCount.call({}, actor),
    listGuidanceContexts.call({}, actor),
  ]);

  return (
    <div className="min-h-svh bg-paper">
      <SkipLink>{t("a11y.skipToContent")}</SkipLink>
      <header className="border-b border-rule bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <a href="/admin" className="text-sm font-semibold">
            {business?.name ?? t("common.appName")}
          </a>
          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-ink-muted">
            {actor.kind === "user"
              ? ROLE_NAMES.has(actor.role)
                ? t(`admin.role.${actor.role}`)
                : actor.role
              : ""}
          </span>
          <span className="hidden font-mono text-xs text-ink-muted sm:inline">
            {t("admin.platformVersion", { version: PLATFORM_VERSION })}
          </span>
          <div className="ms-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-3">
            <AdminGuidanceHelp
              contexts={guidanceContexts}
              label={t("guidance.help")}
            />
            <a
              href="/admin/notifications"
              aria-label={t("notifications.bell", { count: unread })}
              className="relative inline-flex size-9 items-center justify-center rounded-full border border-rule text-ink-muted hover:text-ink"
            >
              <Bell size={18} weight={unread > 0 ? "fill" : "regular"} />
              {unread > 0 ? (
                <span className="absolute -end-1 -top-1 min-w-5 rounded-full bg-danger px-1 text-center font-mono text-[0.65rem] font-bold leading-5 text-on-danger">
                  {unread > 99 ? "99+" : unread}
                </span>
              ) : null}
            </a>
            <a href="/security" className="text-sm text-ink-muted hover:text-ink">
              {t("security.nav")}
            </a>
            <ThemeToggle
              current={theme}
              action={setThemeAction}
              returnTo="/admin"
              labels={themeLabels(t)}
            />
            <SignOutButton label={t("auth.logout")} />
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-x-8 px-4 sm:px-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <div className="pt-4 lg:py-8">
          <AdminNav
            multilingual={(business?.enabledLocales ?? []).length > 1}
            grants={actor.kind === "user" ? actor.grants : []}
            owner={actor.kind === "user" && actor.role === "owner"}
            labels={navLabels(t)}
            groupLabels={{
              menu: t("admin.nav.menu"),
              home: t("admin.nav.group.home"),
              website: t("admin.nav.group.website"),
              sell: t("admin.nav.group.sell"),
              bookings: t("admin.nav.group.bookings"),
              customers: t("admin.nav.group.customers"),
              marketing: t("admin.nav.group.marketing"),
              system: t("admin.nav.group.system"),
            }}
          />
        </div>
        <main id="main-content" tabIndex={-1} className="min-w-0 max-w-5xl py-6 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
