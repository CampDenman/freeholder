// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The first-boot shell (MASTER.md §13). Deliberately not the admin chrome:
// there is no business yet, so there is nothing to navigate.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Storefront } from "@phosphor-icons/react/dist/ssr";
import { ThemeToggle } from "@/ui/ThemeToggle";
import { SkipLink } from "@/ui/SkipLink";
import { readThemePreference, setThemeAction } from "../theme";
import { getT } from "../i18n";
import { themeLabels } from "../themeLabels";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t("setup.badge")} — ${t("common.appName")}` };
}

export default async function SetupLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [theme, t] = await Promise.all([readThemePreference(), getT()]);
  return (
    <div className="min-h-svh bg-paper">
      <SkipLink>{t("a11y.skipToContent")}</SkipLink>
      <header className="border-b border-rule bg-surface">
        <div className="mx-auto flex max-w-2xl items-center gap-2.5 px-6 py-4">
          <Storefront size={20} weight="bold" className="text-accent" />
          <span className="text-sm font-semibold">{t("common.appName")}</span>
          <span className="ms-auto font-mono text-xs text-ink-muted">
            {t("setup.badge")}
          </span>
          <ThemeToggle
            current={theme}
            action={setThemeAction}
            returnTo="/setup"
            labels={themeLabels(t)}
          />
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-2xl px-6 py-10">
        {children}
      </main>
    </div>
  );
}
