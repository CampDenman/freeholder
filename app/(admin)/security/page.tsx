// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { twoFactorStatus } from "@/core/auth/two-factor";
import {
  listSessions,
  recentLoginSecurity,
} from "@/core/auth/session-management/service";
import { actorFromToken } from "@/core/http/actor";
import { getT } from "../../i18n";
import { SecurityControls } from "./SecurityControls";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function SecurityPage() {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (actor.kind !== "user") redirect("/login");
  const [status, activeSessions, loginActivity, t] = await Promise.all([
    twoFactorStatus.call({}, actor),
    listSessions.call({}, actor),
    recentLoginSecurity.call({ limit: 10 }, actor),
    getT(),
  ]);
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
          sessions: activeSessions,
          loginActivity,
        }}
        labels={{
          ...Object.fromEntries([
            "requiredReady", "requiredMissing", "saved", "saveCodes", "authenticator",
            "authenticatorIntro", "enrolled", "notEnrolled", "remove", "setUpAuthenticator",
            "manualSecret", "code", "confirm", "keys", "keysIntro", "addKey", "defaultKeyName",
            "keyFailed", "keyName", "keyNameHint", "recovery", "verifyFirst", "regenerate",
            "sessions", "sessionsIntro", "currentSession", "lastSeen", "expires", "network",
            "unknownNetwork", "signOutSession", "signOutOthers", "signOutOthersIntro",
            "loginActivity", "loginActivityIntro", "noLoginActivity", "newDevice",
            "newNetwork", "noticeSent", "noticePending", "noticeUnavailable", "noticed",
          ].map((key) => [key, t(`security.${key}`)])),
          // ICU placeholders are resolved on the server. Passing the raw
          // catalog entry to the client used to make this page throw before a
          // newly registered owner could enrol their required second factor.
          recoveryIntro: t("security.recoveryIntro", {
            count: status.recoveryCodesRemaining,
          }),
        }}
      />
    </main>
  );
}
