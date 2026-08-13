// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import {
  LOGIN_CHALLENGE_COOKIE,
  loginChallengeDetails,
} from "@/core/auth/two-factor";
import { getT } from "../../../i18n";
import { VerifyLogin } from "./VerifyLogin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function VerifyLoginPage() {
  const token = (await cookies()).get(LOGIN_CHALLENGE_COOKIE)?.value;
  if (!token) redirect("/login");
  const details = await loginChallengeDetails
    .call({ challengeToken: token }, { kind: "anonymous" })
    .catch(() => undefined);
  if (!details) redirect("/login");
  const t = await getT();
  return (
    <main className="mx-auto grid min-h-svh max-w-md content-center px-6 py-16">
      <ShieldCheck size={30} weight="duotone" className="mb-5 text-accent" />
      <h1 className="text-2xl font-bold tracking-tight">{t("security.verifyLogin.title")}</h1>
      <p className="mt-2 mb-8 text-ink-muted">{t("security.verifyLogin.intro")}</p>
      <VerifyLogin
        methods={details.methods}
        webauthnOptions={details.webauthnOptions}
        labels={{
          code: t("security.code"),
          codeHint: t("security.codeHint"),
          checking: t("security.checking"),
          continue: t("security.continue"),
          useKey: t("security.useKey"),
          waitingForKey: t("security.waitingForKey"),
          keyFailed: t("security.keyFailed"),
          startAgain: t("security.startAgain"),
        }}
      />
    </main>
  );
}
