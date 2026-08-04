// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
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

export const dynamic = "force-dynamic";

/**
 * §5: admin is noindexed. It is behind auth as well, but robots directives
 * cost nothing and a crawler that finds a link should not try.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };


export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const actor = await requireStaffActor();
  const [business, theme, t] = await Promise.all([
    currentBusiness(),
    readThemePreference(),
    getT(),
  ]);

  return (
    <div className="min-h-svh bg-paper">
      <header className="border-b border-rule bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3">
          <a href="/admin" className="text-sm font-semibold">
            {business?.name ?? t("common.appName")}
          </a>
          <span className="rounded-full bg-surface-muted px-2 py-0.5 font-mono text-xs text-ink-muted">
            {actor.kind === "user" ? actor.role : ""}
          </span>
          <div className="ms-auto flex items-center gap-3">
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
            labels={{
              region: t("admin.nav.label"),
              overview: t("admin.nav.overview"),
              pages: t("admin.nav.pages"),
              sections: t("admin.nav.sections"),
              media: t("admin.nav.media"),
              forms: t("forms.title"),
              contacts: t("admin.nav.contacts"),
              settings: t("admin.nav.settings"),
            }}
          />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
