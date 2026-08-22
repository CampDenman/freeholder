// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The admin shell (MASTER.md §10). One guard, one nav, one header — every
// screen under /admin inherits all three, so no individual page can forget to
// check who is asking.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/ui/ThemeToggle";
import { readThemePreference, setThemeAction } from "../../theme";
import { getT } from "../../i18n";
import { themeLabels } from "../../themeLabels";
import { requireStaffActor } from "./guard";
import { AdminNav } from "./AdminNav";
import { SignOutButton } from "./SignOutButton";
import { currentBusiness } from "@/core/settings/read";
import { unreadNotificationCount } from "@/core/notifications/service";
import { Bell } from "@phosphor-icons/react/dist/ssr";
import { SkipLink } from "@/ui/SkipLink";
import { listGuidanceContexts } from "@/core/guidance/service";
import { AdminGuidanceHelp } from "./AdminGuidanceHelp";

export const dynamic = "force-dynamic";

/**
 * §5: admin is noindexed. It is behind auth as well, but robots directives
 * cost nothing and a crawler that finds a link should not try.
 */
export async function generateMetadata(): Promise<Metadata> {
  const [business, t] = await Promise.all([currentBusiness(), getT()]);
  return {
    title: `${t("admin.nav.label")} — ${business?.name ?? t("common.appName")}`,
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
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3">
          <a href="/admin" className="text-sm font-semibold">
            {business?.name ?? t("common.appName")}
          </a>
          <span className="rounded-full bg-surface-muted px-2 py-0.5 font-mono text-xs text-ink-muted">
            {actor.kind === "user" ? actor.role : ""}
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
        <div className="mx-auto max-w-5xl px-6">
          <AdminNav
            multilingual={(business?.enabledLocales ?? []).length > 1}
            grants={actor.kind === "user" ? actor.grants : []}
            owner={actor.kind === "user" && actor.role === "owner"}
            labels={{
              region: t("admin.nav.label"),
              overview: t("admin.nav.overview"),
              briefing: t("briefing.title"),
              pages: t("admin.nav.pages"),
              sections: t("admin.nav.sections"),
              templates: t("admin.nav.templates"),
              design: t("admin.nav.design"),
              media: t("admin.nav.media"),
              forms: t("forms.title"),
              traffic: t("analytics.title"),
              experiments: t("experiments.title"),
              health: t("doctor.title"),
              jobs: t("jobs.title"),
              contacts: t("admin.nav.contacts"),
              locations: t("admin.nav.locations"),
              translations: t("admin.nav.translations"),
              settings: t("admin.nav.settings"),
              roles: t("admin.nav.roles"),
              invitations: t("admin.nav.invitations"),
              builder: t("admin.nav.builder"),
              demos: t("admin.nav.demos"),
              invoices: t("invoices.title"),
              payments: t("payments.title"),
              pos: t("pos.title"),
              products: t("catalog.title"),
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
              hire: t("hire.title"),
              events: t("events.title"),
              newsletters: t("newsletters.title"),
              contribute: t("contribute.title"),
              plugins: t("plugins.title"),
              imports: t("imports.title"),
              work: t("work.title"),
            }}
          />
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-5xl px-6 py-8">
        {children}
      </main>
    </div>
  );
}
