// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Asking for a password reset (MASTER.md §9, §13 step 1).
//
// Public, like the sign-in it sits beside, and outside /admin so the guard on
// that layout never applies — the person here is precisely the person who
// cannot pass it.
import type { Metadata } from "next";
import { Storefront } from "@phosphor-icons/react/dist/ssr";
import { ThemeToggle } from "@/ui/ThemeToggle";
import { Callout } from "@/ui/primitives";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { canDeliverMail } from "@/core/auth/reset";
import { currentBusiness } from "@/core/settings/read";
import { readThemePreference, setThemeAction } from "../../theme";
import { getT } from "../../i18n";
import { themeLabels } from "../../themeLabels";
import { ForgotForm } from "./ForgotForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ForgotPasswordPage() {
  const [business, theme, t] = await Promise.all([
    currentBusiness(),
    readThemePreference(),
    getT(),
  ]);
  // Said before they wait for an email that is never coming. An instance with
  // no mailer still has a way back in — it is just not this one.
  const delivers = await canDeliverMail();

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
              returnTo="/forgot"
              labels={themeLabels(t)}
            />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-md px-6 py-16">
        <h1 className="text-2xl font-bold tracking-tight">
          {t("auth.forgot.title")}
        </h1>
        <p className="mt-2 mb-8 text-ink-muted">{t("auth.forgot.intro")}</p>

        {delivers ? null : (
          <div className="mb-6">
            <Callout tone="warning" icon={<WarningCircle size={17} weight="fill" />}>
              {t("auth.forgot.noMail")}
            </Callout>
          </div>
        )}

        <ForgotForm
          labels={{
            email: t("auth.login.email"),
            submit: t("auth.forgot.submit"),
            sent: t("auth.forgot.sent"),
          }}
        />
        <a href="/login" className="mt-6 inline-block text-sm text-ink-muted">
          {t("auth.backToSignIn")}
        </a>
      </main>
    </div>
  );
}
