// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.14: an exact, read-authorized destination for a subscription search hit.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSubscription } from "@/modules/subscriptions/service";
import { getContact } from "@/core/contacts/service";
import { currentBusiness } from "@/core/settings/read";
import { hasModuleAccess, ServiceError } from "@/core/service";
import { Card, CardBody, Pill } from "@/ui/primitives";
import { getLocale, getT } from "../../../../i18n";
import { domainOrNull } from "../../../read-helpers";
import { requireStaffActor } from "../../guard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function SubscriptionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireStaffActor("subscriptions");
  const { id } = await params;
  const result = await getSubscription.call({ id }, actor).catch((error: unknown) => {
    if (error instanceof ServiceError && (error.code === "not_found" || error.code === "validation")) notFound();
    throw error;
  });
  const { subscription, plan } = result;
  const [t, locale, business, contact] = await Promise.all([getT(), getLocale(), currentBusiness(),
    domainOrNull(getContact.call({ id: subscription.contactId }, actor))]);
  const date = (value: Date) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: business?.timezone ?? "UTC" }).format(value);
  return <div className="grid gap-6">
    <h1 className="text-xl font-bold tracking-tight">{plan?.name ?? t("admin.search.kind.subscription")}</h1>
    <Card><CardBody><dl className="grid gap-3 text-sm">
      <div><dt className="text-ink-muted">{t("subscriptions.detail.identifier")}</dt><dd className="break-all">{subscription.id}</dd></div>
      <div><dt className="text-ink-muted">{t("subscriptions.detail.contact")}</dt><dd>{contact?.name ?? subscription.contactId}</dd></div>
      <div><dt className="text-ink-muted">{t("subscriptions.detail.status")}</dt><dd><Pill>{t(`subscriptions.status.${subscription.status}`)}</Pill></dd></div>
      <div><dt className="text-ink-muted">{t("subscriptions.detail.period")}</dt><dd>{date(subscription.currentPeriodStart)} – {date(subscription.currentPeriodEnd)}</dd></div>
      <div><dt className="text-ink-muted">{t("subscriptions.detail.billing")}</dt><dd>{t(`subscriptions.billing.${subscription.billingMode}`)}</dd></div>
    </dl></CardBody></Card>
    {hasModuleAccess(actor, "subscriptions", "manage") ? <a className="text-accent" href={`/admin/subscriptions?plan=${subscription.planId}`}>{t("subscriptions.detail.manage")}</a> : null}
    <a className="text-accent" href="/admin/search">{t("admin.search.title")}</a>
  </div>;
}
