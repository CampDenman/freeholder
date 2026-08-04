// Copyright (C) 2026 Camp Denman Society
// SPDX-License-Identifier: AGPL-3.0-only
// Spending a password reset link (MASTER.md §9, §13 step 1).
//
// The token is read here and handed to the form as a hidden field, because a
// Server Action does not see the page's query string. It is never validated on
// this screen: telling somebody their link is bad before they have typed
// anything is an oracle for guessing links.
import type { Metadata } from "next";
import { Storefront } from "@phosphor-icons/react/dist/ssr";
import { ThemeToggle } from "@/ui/ThemeToggle";
import { currentBusiness } from "@/core/settings/read";
import { readThemePreference, setThemeAction } from "../../theme";
import { getT } from "../../i18n";
import { themeLabels } from "../../themeLabels";
import { ResetForm } from "./ResetForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const [{ token }, business, theme, t] = await Promise.all([
    searchParams,
    currentBusiness(),
    readThemePreference(),
    getT(),
  ]);

  return (
    <div className="min-h-svh bg-paper">
      <header className="border-b border-rule bg-surface">
        <div className="mx-auto flex max-w-md items-center gap-2.5 px-6 py-4">
          <Storefront size={20} weight="bold" className="text-accent" />
          <span className="text-sm font-semibold">
            {business?.name ?? t("common.appName")}
          </span>
          <div className="ms-auto">
            <ThemeToggle
              current={theme}
              action={setThemeAction}
              returnTo="/login"
              labels={themeLabels(t)}
            />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-md px-6 py-16">
        <h1 className="text-2xl font-bold tracking-tight">
          {t("auth.reset.title")}
        </h1>
        <p className="mt-2 mb-8 text-ink-muted">{t("auth.reset.intro")}</p>

        {token ? (
          <ResetForm
            token={token}
            labels={{
              password: t("auth.reset.password"),
              hint: t("auth.reset.hint"),
              submit: t("auth.reset.submit"),
              done: t("auth.reset.done"),
              backToSignIn: t("auth.backToSignIn"),
            }}
          />
        ) : (
          <p className="text-sm text-ink-muted">{t("auth.reset.missing")}</p>
        )}
      </main>
    </div>
  );
}
