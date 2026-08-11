// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
// Public staff-invitation acceptance (MASTER.md §43 C1.02).
import type { Metadata } from "next";
import { Storefront } from "@phosphor-icons/react/dist/ssr";
import { inspectInvitation } from "@/core/invitations/service";
import { currentBusiness } from "@/core/settings/read";
import { ThemeToggle } from "@/ui/ThemeToggle";
import { getLocale, getT } from "../../i18n";
import { readThemePreference, setThemeAction } from "../../theme";
import { themeLabels } from "../../themeLabels";
import { AcceptInvitationForm } from "./AcceptInvitationForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const ANONYMOUS = { kind: "anonymous" } as const;

export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const [{ token }, business, theme, t, locale] = await Promise.all([
    searchParams,
    currentBusiness(),
    readThemePreference(),
    getT(),
    getLocale(),
  ]);
  const invitation = token
    ? await inspectInvitation.call({ token }, ANONYMOUS).catch(() => ({
        status: "invalid" as const,
      }))
    : { status: "invalid" as const };
  const invalidMessage = {
    invalid: t("invitation.accept.invalid"),
    expired: t("invitation.accept.expired"),
    revoked: t("invitation.accept.revoked"),
    accepted: t("invitation.accept.accepted"),
    unavailable: t("invitation.accept.unavailable"),
  } as const;

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
              returnTo={token ? `/invite?token=${encodeURIComponent(token)}` : "/invite"}
              labels={themeLabels(t)}
            />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-md px-6 py-16">
        <h1 className="text-2xl font-bold tracking-tight">
          {t("invitation.accept.title")}
        </h1>
        {invitation.status === "pending" && token ? (
          <div className="grid gap-7">
            <p className="mt-2 text-ink-muted">
              {t("invitation.accept.intro", {
                email: invitation.email ?? "",
                role: invitation.roleName ?? "",
              })}
            </p>
            <p className="text-sm text-ink-muted">
              {t("invitation.accept.expires", {
                when: invitation.expiresAt
                  ? new Intl.DateTimeFormat(locale, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(invitation.expiresAt)
                  : "",
              })}
            </p>
            <AcceptInvitationForm
              token={token}
              labels={{
                password: t("invitation.accept.password"),
                passwordConfirm: t("invitation.accept.passwordConfirm"),
                passwordHint: t("invitation.accept.passwordHint"),
                submit: t("invitation.accept.submit"),
                accepting: t("invitation.accept.accepting"),
              }}
            />
          </div>
        ) : (
          <div className="mt-5 grid gap-5">
            <p className="text-ink-muted">
              {invalidMessage[
                invitation.status === "pending" ? "invalid" : invitation.status
              ]}
            </p>
            <a href="/login" className="text-sm font-medium text-accent">
              {t("auth.backToSignIn")}
            </a>
          </div>
        )}
      </main>
    </div>
  );
}
