// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { twoFactorStatus } from "@/core/auth/two-factor";
import { actorFromToken } from "@/core/http/actor";
import { getT } from "../../i18n";
import { SecurityControls } from "./SecurityControls";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function SecurityPage() {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (actor.kind !== "user") redirect("/login");
  const [status, t] = await Promise.all([twoFactorStatus.call({}, actor), getT()]);
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-8 flex items-start gap-4">
        <ShieldCheck size={32} weight="duotone" className="mt-1 text-accent" />
        <div><h1 className="text-2xl font-bold tracking-tight">{t("security.title")}</h1><p className="mt-2 text-ink-muted">{t("security.intro")}</p></div>
        <a href="/admin" className="ms-auto text-sm text-ink-muted underline">{t("security.back")}</a>
      </div>
      <SecurityControls
        status={{
          required: status.required,
          stepUpValid: status.stepUpValid,
          totp: Boolean(status.totp),
          webauthn: status.webauthn,
          recoveryCodesRemaining: status.recoveryCodesRemaining,
        }}
        labels={Object.fromEntries([
          "requiredReady", "requiredMissing", "saved", "saveCodes", "authenticator",
          "authenticatorIntro", "enrolled", "notEnrolled", "remove", "setUpAuthenticator",
          "manualSecret", "code", "confirm", "keys", "keysIntro", "addKey", "defaultKeyName",
          "keyFailed", "keyName", "keyNameHint", "recovery", "recoveryIntro", "verifyFirst", "regenerate",
        ].map((key) => [key, t(`security.${key}`)]))}
      />
    </main>
  );
}
