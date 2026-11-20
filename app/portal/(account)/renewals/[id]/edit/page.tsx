// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Correct a tracked charge (MASTER.md §43 C12.40).
//
// The row is read through `renewalAlerts.get` with the caller's own contact
// id, which is the self-service path C8.11 defines: the field must be present
// and must be the caller's own, so this page cannot be pointed at anybody
// else's register by editing the URL.
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { myProfile } from "@/core/portal/service";
import { ServiceError } from "@/core/service";
import { getTrackedSubscription } from "@/modules/renewal-alerts/service";
import { getT } from "../../../../../i18n";
import { RenewalForm } from "../../RenewalForm";
import { saveRenewalAction } from "../../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("renewals.editTitle"),
    robots: { index: false, follow: false },
  };
}

export default async function EditRenewal({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ id }, { error }, t, jar] = await Promise.all([
    params,
    searchParams,
    getT(),
    cookies(),
  ]);
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  if (actor.kind !== "user") {
    redirect(`/portal/login?returnTo=${encodeURIComponent(`/portal/renewals/${id}/edit`)}`);
  }

  const me = await myProfile.call({}, actor);
  let tracked;
  try {
    const found = await getTrackedSubscription.call({ id, contactId: me.contactId }, actor);
    tracked = found.subscription;
  } catch (e) {
    if (e instanceof ServiceError && ["not_found", "validation"].includes(e.code)) notFound();
    throw e;
  }

  return (
    <section className="grid gap-4">
      <a className="underline" href={`/portal/records/renewals/${id}`}>
        {t("portal.record.back")}
      </a>
      <h1 className="text-2xl font-semibold text-ink">{t("renewals.editTitle")}</h1>
      <RenewalForm tracked={tracked} error={error} action={saveRenewalAction} />
    </section>
  );
}
