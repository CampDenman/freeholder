// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { twoFactorStatus } from "@/core/auth/two-factor";
import { actorFromToken } from "@/core/http/actor";
import { getT } from "../../../i18n";
import { StepUpForm } from "./StepUpForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function VerifySecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (actor.kind !== "user") redirect("/login");
  const status = await twoFactorStatus.call({}, actor);
  if (!status.totp && status.webauthn.length === 0) redirect("/security?required=1");
  const requested = (await searchParams).returnTo ?? "/admin";
  const returnTo = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/admin";
  if (status.stepUpValid && actor.security?.twoFactorVerified) redirect(returnTo);
  const t = await getT();
  return (
    <main className="mx-auto grid min-h-svh max-w-md content-center px-6 py-16">
      <ShieldCheck size={30} weight="duotone" className="mb-5 text-accent" />
      <h1 className="text-2xl font-bold tracking-tight">{t("security.verify.title")}</h1>
      <p className="mt-2 mb-8 text-ink-muted">{t("security.verify.intro")}</p>
      <StepUpForm
        hasCode={Boolean(status.totp) || status.recoveryCodesRemaining > 0}
        hasWebAuthn={status.webauthn.length > 0}
        returnTo={returnTo}
        labels={Object.fromEntries([
          "code", "codeHint", "checking", "continue", "useKey", "waitingForKey", "keyFailed",
        ].map((key) => [key, t(`security.${key}`)]))}
      />
    </main>
  );
}
