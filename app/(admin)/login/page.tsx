// Copyright (C) 2026 Camp Denman Society
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
import { getBusiness, setupState } from "@/core/settings/service";
import { ThemeToggle } from "@/ui/ThemeToggle";
import { readThemePreference, setThemeAction } from "../../theme";
import { SignInForm } from "./SignInForm";

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

  const [business, theme] = await Promise.all([
    getBusiness.call({}, ANONYMOUS),
    readThemePreference(),
  ]);

  return (
    <div className="min-h-svh bg-paper">
      <header className="border-b border-rule bg-surface">
        <div className="mx-auto flex max-w-md items-center gap-2.5 px-6 py-4">
          <Storefront size={20} weight="bold" className="text-accent" />
          <span className="text-sm font-semibold">
            {business?.name ?? "Freeholder"}
          </span>
          <div className="ms-auto">
            <ThemeToggle
              current={theme}
              action={setThemeAction}
              returnTo="/login"
            />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-md px-6 py-16">
        <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
        <p className="mt-2 mb-8 text-ink-muted">
          Owners and staff only. Customers get a link by email instead.
        </p>
        <SignInForm />
      </main>
    </div>
  );
}
