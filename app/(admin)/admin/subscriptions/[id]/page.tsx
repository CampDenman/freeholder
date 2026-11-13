// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.14: an exact, read-authorized destination for a subscription search hit.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {listTrialSetupDispatches} from "@/modules/subscriptions/setup-reconciliation";
import {reconcileTrialSetupDispatchAction} from "../../../subscription-actions";
import { CommercialAmendment } from "../../../../components/CommercialAmendment";
import { GrossProration } from "../../../../components/GrossProration";
import { grossProrationStatus } from "@/modules/subscriptions/proration-service";
import { ProviderReaderRecovery } from "../../../../components/ProviderReaderRecovery";
import { providerReaderRecoveryPlan } from "@/modules/subscriptions/provider-reader-recovery";
import { merchantAmendmentStatus } from "@/modules/subscriptions/commercial-amendments";
import { getSubscription, listOfferedPlans } from "@/modules/subscriptions/service";
import { getContact } from "@/core/contacts/service";
import { currentBusiness } from "@/core/settings/read";
import { hasModuleAccess, ServiceError } from "@/core/service";
import { Button,Callout,Card,CardBody,CardHeader,Field,Input,Pill } from "@/ui/primitives";
import { getLocale, getT } from "../../../../i18n";
import { domainOrNull } from "../../../read-helpers";
import { requireStaffActor } from "../../guard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function SubscriptionDetailPage({ params,searchParams }: { params: Promise<{ id: string }>;searchParams:Promise<{setupError?:string;setupReconciled?:string;setupAfter?:string;readerResult?:string}> }) {
  const actor = await requireStaffActor("subscriptions");
  const { id } = await params;
  const query=await searchParams;
  const result = await getSubscription.call({ id }, actor).catch((error: unknown) => {
    if (error instanceof ServiceError && (error.code === "not_found" || error.code === "validation")) notFound();
    throw error;
  });
  const { subscription, plan } = result;
  const [t, locale, business, contact] = await Promise.all([getT(), getLocale(), currentBusiness(),
    domainOrNull(getContact.call({ id: subscription.contactId }, actor))]);
  const canRecover=hasModuleAccess(actor,"subscriptions","manage") && actor.kind==="user" && !actor.keyScopes;
  const amendment = await merchantAmendmentStatus.call({id},actor);
  const proration = await grossProrationStatus.call({id},actor);
  const offered = canRecover && ["active","trialing"].includes(subscription.status) ? await listOfferedPlans.call({subscriptionId:id},actor) : [];
  const fresh=actor.kind==="user" && actor.security?.stepUpValid!==false;
  const cursor=query.setupAfter && /^[a-f0-9-]{36}$/i.test(query.setupAfter)?query.setupAfter:undefined;
  const recovery=canRecover && fresh?await listTrialSetupDispatches.call({subscriptionId:id,afterId:cursor},actor):null;
  const readers=canRecover && fresh && amendment.commercial?await providerReaderRecoveryPlan.call({subscriptionId:id},actor):[];
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
    {query.setupError ? <Callout tone="danger">{t(`subscriptions.setup.error.${["validation","permission","conflict"].includes(query.setupError)?query.setupError:"conflict"}`)}</Callout>:null}
    {query.setupReconciled ? <Callout tone="success">{t("subscriptions.setup.saved")}</Callout>:null}
    {query.readerResult ? <Callout tone={query.readerResult==="saved"?"success":"danger"}>{t(query.readerResult==="saved"?"subscriptions.reader.saved":"subscriptions.reader.failed")}</Callout>:null}
    {readers.length ? <ProviderReaderRecovery subscriptionId={id} rows={readers} locale={locale}/> : null}
    {canRecover && !fresh ? <Card><CardHeader title={t("subscriptions.setup.title")}/><CardBody><a className="text-accent underline" href={`/security/verify?returnTo=${encodeURIComponent(`/admin/subscriptions/${id}`)}`}>{t("subscriptions.setup.verify")}</a></CardBody></Card>:null}
    {recovery && (recovery.rows.length>0 || query.setupAfter) ? <Card><CardHeader title={t("subscriptions.setup.title")}/><CardBody>
      <p className="max-w-prose text-sm text-ink-muted">{t("subscriptions.setup.intro")}</p>
      <p className="max-w-prose text-sm text-ink-muted">{t("subscriptions.setup.evidenceHint")}</p>
      <ul className="grid list-none gap-5 p-0">{recovery.rows.map(item=><li key={item.id} className="min-w-0 rounded-md border border-rule p-3">
        <div className="mb-3 flex flex-wrap gap-2"><Pill>{t(`subscriptions.setup.kind.${item.kind}`)}</Pill><Pill tone={item.state==="running"||item.state==="unknown"?"warning":"neutral"}>{t(`subscriptions.setup.state.${item.state}`)}</Pill>{item.privacyPending?<Pill tone="warning">{t("subscriptions.setup.privacyPending")}</Pill>:null}</div>
        <dl className="mb-4 grid gap-2 text-sm">
          <div><dt className="text-ink-muted">{t("subscriptions.setup.dispatch")}</dt><dd dir="ltr" className="break-all font-mono">{item.id}</dd></div>
          <div><dt className="text-ink-muted">{t("subscriptions.setup.account")}</dt><dd dir="ltr" className="break-all font-mono">{item.provider} · {item.providerAccountId||t("subscriptions.setup.siteAccount")}</dd></div>
          <div><dt className="text-ink-muted">{t("subscriptions.setup.originalKey")}</dt><dd dir="ltr" className="break-all font-mono">{item.idempotencyKey}</dd></div>
          <div><dt className="text-ink-muted">{t("subscriptions.setup.started")}</dt><dd>{date(item.startedAt)}</dd></div>
        </dl>
        {item.state==="running"||item.state==="unknown"?<form action={reconcileTrialSetupDispatchAction} className="grid gap-3">
          <input type="hidden" name="subscriptionId" value={id}/><input type="hidden" name="dispatchId" value={item.id}/>
          <fieldset className="grid gap-2"><legend className="mb-2 text-sm font-medium">{t("subscriptions.setup.outcome")}</legend><label className="flex items-start gap-2 text-sm"><input type="radio" name="outcome" value="completed" defaultChecked className="mt-1 shrink-0"/><span>{t("subscriptions.setup.completed")}</span></label><label className="flex items-start gap-2 text-sm"><input type="radio" name="outcome" value="cancelled" className="mt-1 shrink-0"/><span>{t("subscriptions.setup.cancelled")}</span></label></fieldset>
          <Field htmlFor={`operation-${item.id}`} label={t("subscriptions.setup.operation")}><Input id={`operation-${item.id}`} name="providerOperationRef" required minLength={8} maxLength={300}/></Field>
          <Field htmlFor={`provider-evidence-${item.id}`} label={t("subscriptions.setup.providerEvidence")}><textarea id={`provider-evidence-${item.id}`} name="providerEvidence" required minLength={20} maxLength={2000} rows={4} className="w-full rounded-md border border-rule bg-surface px-3 py-2 text-sm"/></Field>
          <Field htmlFor={`caller-evidence-${item.id}`} label={t("subscriptions.setup.callerEvidence")}><textarea id={`caller-evidence-${item.id}`} name="callerStopEvidence" required minLength={20} maxLength={2000} rows={3} className="w-full rounded-md border border-rule bg-surface px-3 py-2 text-sm"/></Field>
          <Field htmlFor={`customer-${item.id}`} label={t("subscriptions.setup.customer")} hint={t("subscriptions.setup.resourceHint")}><Input id={`customer-${item.id}`} name="providerCustomerRef" dir="ltr" maxLength={500} autoComplete="off"/></Field>
          {item.kind==="session"?<Field htmlFor={`session-${item.id}`} label={t("subscriptions.setup.session")}><Input id={`session-${item.id}`} name="providerRef" dir="ltr" maxLength={500} autoComplete="off"/></Field>:null}
          <Field htmlFor={`confirm-${item.id}`} label={t("subscriptions.setup.confirm")} hint={t("subscriptions.setup.confirmHint")}><Input id={`confirm-${item.id}`} name="confirmation" dir="ltr" required autoComplete="off"/></Field>
          <div><Button type="submit">{t("subscriptions.setup.submit")}</Button></div>
        </form>:<p className="text-sm text-ink-muted">{t(item.state==="succeeded"?"subscriptions.setup.machineSource":"subscriptions.setup.humanSource")}</p>}
        {item.resolution.source==="human_provider_confirmation"?<details className="mt-3 text-sm"><summary className="cursor-pointer text-accent">{t("subscriptions.setup.providerEvidence")}</summary><dl className="mt-3 grid gap-3"><div><dt className="text-ink-muted">{t("subscriptions.setup.operation")}</dt><dd className="break-words">{item.resolution.providerOperationRef}</dd></div><div><dt className="text-ink-muted">{t("subscriptions.setup.providerEvidence")}</dt><dd className="whitespace-pre-wrap break-words">{item.resolution.providerEvidence}</dd></div><div><dt className="text-ink-muted">{t("subscriptions.setup.callerEvidence")}</dt><dd className="whitespace-pre-wrap break-words">{item.resolution.callerStopEvidence}</dd></div></dl></details>:null}
      </li>)}</ul>
      <div className="flex flex-wrap gap-4"><a className="text-sm text-accent underline" href={`/admin/subscriptions/${id}`}>{t("subscriptions.setup.firstPage")}</a>{recovery.nextCursor?<a className="text-sm text-accent underline" href={`/admin/subscriptions/${id}?setupAfter=${recovery.nextCursor}`}>{t("subscriptions.setup.nextPage")}</a>:null}</div>
    </CardBody></Card>:null}
    {canRecover && amendment.commercial ? proration.prorating ? <GrossProration id={id} audience="owner" locale={locale} offered={offered} status={proration}/> : <CommercialAmendment id={id} audience="owner" locale={locale} offered={offered} status={amendment}/> : null}
    {hasModuleAccess(actor, "subscriptions", "manage") ? <a className="text-accent" href={`/admin/subscriptions?plan=${subscription.planId}`}>{t("subscriptions.detail.manage")}</a> : null}
    <a className="text-accent" href="/admin/search">{t("admin.search.title")}</a>
  </div>;
}
