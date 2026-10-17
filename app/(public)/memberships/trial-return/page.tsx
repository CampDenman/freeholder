// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { currentBusiness } from "@/core/settings/read";
import { myMembership, myMembershipPaymentMethods } from "@/modules/subscriptions/public-signup";
import { Button, Callout, Field, Select } from "@/ui/primitives";
import { getLocale, getT } from "../../../i18n";
import { startTrialAction } from "../actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("memberships.startTrial"), robots: { index: false, follow: false } };
}

export default async function TrialReturn({
  searchParams,
}: {
  searchParams: Promise<{ subscription?: string; error?: string }>;
}) {
  const [t, locale, business, jar, query] = await Promise.all([getT(), getLocale(), currentBusiness(), cookies(), searchParams]);
  const href = (path: string) => (business ? localizeCustomerHref(path, locale, business) : path);
  const id = query.subscription ?? "";
  if (!z.uuid().safeParse(id).success) notFound();
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  if (actor.kind !== "user") redirect(href(`/portal/login?returnTo=${encodeURIComponent(`/memberships/trial-return?subscription=${id}`)}`));
  const membership = await myMembership.call({ id }, actor).catch(() => null);
  if (!membership) notFound();
  if (!membership.cardSetup) redirect(href(`/portal/subscriptions/${id}`));
  const methods = await myMembershipPaymentMethods.call({}, actor).catch(() => []);
  return (
    <div className="mx-auto grid max-w-xl gap-6 px-6 py-12">
      <h1 className="text-3xl font-semibold">{membership.name}</h1>
      {query.error ? <Callout tone="danger">{t("memberships.failed")}</Callout> : null}
      {methods.length === 0 ? (
        <Callout>{t("memberships.cardWaiting")}</Callout>
      ) : (
        <form action={startTrialAction} className="grid gap-3">
          <p>{t("memberships.cardSetupPending")}</p>
          <input type="hidden" name="subscriptionId" value={id} />
          <Field label={t("memberships.paymentMethod")} htmlFor="trial-method">
            <Select id="trial-method" name="paymentMethodId" defaultValue={methods[0]?.id}>
              {methods.map((method) => (
                <option key={method.id} value={method.id}>{method.label}</option>
              ))}
            </Select>
          </Field>
          <Button type="submit">{t("memberships.startTrial")}</Button>
        </form>
      )}
      <a className="underline" href={href(`/portal/subscriptions/${id}`)}>{t("memberships.manage")}</a>
    </div>
  );
}
