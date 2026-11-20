// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Track a new charge (MASTER.md §43 C12.40).
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { renewalAlertsEnabled } from "@/modules/renewal-alerts/settings";
import { getT } from "../../../../i18n";
import { RenewalForm } from "../RenewalForm";
import { saveRenewalAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("renewals.newTitle"),
    // A person's own register is never a search result.
    robots: { index: false, follow: false },
  };
}

export default async function NewRenewal({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ error }, t, jar] = await Promise.all([searchParams, getT(), cookies()]);
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  if (actor.kind !== "user") redirect("/portal/login?returnTo=%2Fportal%2Frenewals%2Fnew");
  if (!await renewalAlertsEnabled()) notFound();

  return (
    <section className="grid gap-4">
      <a className="underline" href="/portal/renewals">
        {t("portal.record.back")}
      </a>
      <h1 className="text-2xl font-semibold text-ink">{t("renewals.newTitle")}</h1>
      <RenewalForm error={error} action={saveRenewalAction} />
    </section>
  );
}
