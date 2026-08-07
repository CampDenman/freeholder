// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Sign-in for owners and staff (§9: email + password, OTP to follow).
//
// It sits in the (admin) group but *outside* /admin, so the guard on that
// layout never applies to it — a login page behind an auth check is an
// infinite redirect.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Storefront } from "@phosphor-icons/react/dist/ssr";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { setupState } from "@/core/settings/service";
import { ThemeToggle } from "@/ui/ThemeToggle";
import { readThemePreference, setThemeAction } from "../../theme";
import { getT } from "../../i18n";
import { themeLabels } from "../../themeLabels";
import { SignInForm } from "./SignInForm";
import { currentBusiness } from "@/core/settings/read";

export const dynamic = "force-dynamic";

// §5: admin surfaces are noindexed. They are also behind auth, but a login
// page is not, so this one needs saying explicitly.
export const metadata: Metadata = { robots: { index: false, follow: false } };

const ANONYMOUS = { kind: "anonymous" } as const;

export default async function LoginPage() {
  const state = await setupState.call({}, ANONYMOUS);
  // Nothing to sign in to yet.
  if (!state.hasOwner) redirect("/setup");

  const actor = await actorFromToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
  );
  if (actor.kind === "user" && actor.role !== "customer") redirect("/admin");

  const [business, theme, t] = await Promise.all([
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
          {t("auth.login.title")}
        </h1>
        <p className="mt-2 mb-8 text-ink-muted">{t("auth.login.intro")}</p>
        <SignInForm
          labels={{
            email: t("auth.login.email"),
            password: t("auth.login.password"),
            submit: t("auth.login.submit"),
            pending: t("auth.login.pending"),
          }}
        />
        <a href="/forgot" className="mt-6 inline-block text-sm text-ink-muted">
          {t("auth.forgot.link")}
        </a>
      </main>
    </div>
  );
}
