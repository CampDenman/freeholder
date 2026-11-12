// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { formatDateTime, formatMoney } from "@/core/i18n";
import { actorString, hasModuleAccess, ServiceError } from "@/core/service";
import { currentBusiness } from "@/core/settings/read";
import { merchantPaymentReview } from "@/modules/invoicing/merchant-payment-review";
import { Button, Callout, Card, CardBody, CardHeader, Field, Input } from "@/ui/primitives";
import { getLocale, getT } from "../../../../../i18n";
import { requireStaffActor } from "../../../guard";
import { reconcileMerchantPaymentAction } from "./actions";
import { readCheckoutLink } from "./checkout-link";

export const dynamic = "force-dynamic";
const states = ["unresolved", "ambiguous", "open", "pending", "paid", "not_paid"];

export default async function MerchantPaymentPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ offset?: string; saved?: string; error?: string }>;
}) {
  const actor = await requireStaffActor("invoicing");
  const [{ id }, query, t, locale, business] = await Promise.all([params, searchParams, getT(), getLocale(), currentBusiness()]);
  const offset = /^\d{1,6}$/.test(query.offset ?? "") ? Math.min(100000, Number(query.offset)) : 0;
  const review = await merchantPaymentReview.call({ paymentId: id, offset }, actor).catch((error: unknown) => {
    if (error instanceof ServiceError && error.code === "not_found") notFound();
    throw error;
  });
  if (!review) notFound();
  const canManage = hasModuleAccess(actor, "invoicing", "manage"), stepUpValid = actor.kind === "user" && actor.security?.stepUpValid !== false;
  const date = (value: Date) => formatDateTime(value, business?.timezone ?? "UTC", locale);
  const money = (value: number, currency: string) => formatMoney(value, currency, locale);
  const saved = states.includes(query.saved ?? "") ? query.saved : undefined;
  const error = ["validation", "permission", "conflict", "not_found", "rate_limited"].includes(query.error ?? "") ? query.error : query.error ? "failed" : undefined;
  const chargeAccount = review.routing.providerAccountId ?? review.routing.providerPlatformAccountId;
  const originalCheckoutUrl = review.payment.method === "hosted_checkout" && ["created", "processing"].includes(review.payment.status)
    ? readCheckoutLink((await cookies()).get("freeholder_merchant_checkout_review")?.value, id, actorString(actor)) : null;
  return <div className="grid gap-5">
    <a className="text-accent underline" href={`/admin/invoices/${review.payment.invoiceId}`}>{t("merchantPayments.backToInvoice")}</a>
    <h1 className="text-xl font-semibold">{t("merchantPayments.title")}</h1>
    <p className="text-ink-muted">{t("merchantPayments.intro")}</p>
    {error ? <Callout tone="danger">{t("merchantPayments.error")}</Callout> : null}
    {saved ? <Callout>{t(`merchantPayments.result.${saved}`)}</Callout> : null}
    <Card><CardHeader title={t("invoices.payments")} /><CardBody><div className="grid gap-3">
      <p className="font-semibold">{money(review.payment.amountMinor, review.payment.currency)} · <code>{review.payment.status}</code></p>
      <dl className="grid gap-2 text-sm">
        <div><dt>{t("merchantPayments.chargeAccount")}</dt><dd><bdi>{chargeAccount}</bdi></dd></div>
        <div><dt>{t("merchantPayments.recipientAccount")}</dt><dd><bdi>{review.routing.destinationAccountId ?? review.routing.providerAccountId ?? review.routing.providerPlatformAccountId}</bdi></dd></div>
      </dl>
      {review.terminalReceipt ? <Callout>{t("merchantPayments.terminal")}</Callout> : null}
      {originalCheckoutUrl ? <a className="text-accent underline" href={originalCheckoutUrl} rel="noreferrer">{t("merchantPayments.openCheckout")}</a> : null}
      {["hosted_checkout", "saved_method"].includes(review.payment.method) && canManage && stepUpValid ? <form action={reconcileMerchantPaymentAction} className="grid gap-3">
        <input type="hidden" name="paymentId" value={id} />
        {review.payment.method === "saved_method"
          ? <Field label={t("merchantPayments.paymentReference")} htmlFor="original-intent"><Input id="original-intent" name="paymentRef" defaultValue={review.payment.providerRef ?? ""} maxLength={200} pattern="pi_[A-Za-z0-9_]+" /></Field>
          : <Field label={t("merchantPayments.checkoutReference")} htmlFor="original-checkout"><Input id="original-checkout" name="checkoutRef" defaultValue={review.payment.providerCheckoutRef ?? ""} maxLength={200} pattern="cs_[A-Za-z0-9_]+" /></Field>}
        <p className="text-sm text-ink-muted">{t("merchantPayments.checkoutReferenceHint")}</p>
        <div className="flex flex-wrap gap-3"><Button type="submit" name="action" value="inspect">{t("merchantPayments.inspect")}</Button><Button type="submit" name="action" value="retire" variant="quiet">{t(review.payment.method === "saved_method" ? "merchantPayments.retireIntent" : "merchantPayments.retire")}</Button></div>
      </form> : null}
      {canManage && stepUpValid && review.payment.providerRef?.startsWith("pi_") ? <form action={reconcileMerchantPaymentAction}><input type="hidden" name="paymentId" value={id} /><Button type="submit" name="action" value="inspect_charge" variant="quiet">{t("merchantPayments.inspectCharge")}</Button></form> : null}
      {canManage && !stepUpValid ? <Callout><a className="text-accent underline" href={`/security/verify?returnTo=${encodeURIComponent(`/admin/payments/${id}/merchant`)}`}>{t("merchantPayments.verify")}</a></Callout> : null}
      <p className="text-sm text-ink-muted">{t("merchantPayments.unknownHint")}</p>
    </div></CardBody></Card>
    <Card><CardHeader title={t("merchantPayments.actualMoney")} /><CardBody><div className="grid gap-3">
      {review.observations.map(observation => <div key={observation.id} className="grid gap-1 border-b border-rule pb-3 text-sm">
        <p>{money(observation.amountMinor, observation.currency)} · <code>{observation.status}</code> · {date(observation.observedAt)}</p>
        <p><bdi>{observation.providerRef}</bdi></p>
        <p><bdi>{observation.chargeAccountId ?? observation.providerPlatformAccountId}</bdi> → <bdi>{observation.recipientAccountId ?? observation.providerPlatformAccountId}</bdi></p>
        {observation.status === "succeeded" && (!observation.customerChargeVerified || observation.amountMinor !== review.payment.amountMinor || observation.currency !== review.payment.currency || review.payment.status !== "succeeded" || observation.providerRef !== review.payment.providerRef) ? <Callout tone="danger">{t("merchantPayments.unapplied")}</Callout> : null}
        {!observation.settlementVerified ? <p>{t("merchantPayments.settlementPending")}</p> : null}
      </div>)}
    </div></CardBody></Card>
    <Card><CardHeader title={t("merchantPayments.dispatches")} /><CardBody><div className="grid gap-2 text-sm">
      {review.dispatches.map(dispatch => <p key={dispatch.id}>#{dispatch.ordinal} · {date(dispatch.dispatchedAt)}{dispatch.refusalCode ? <> · <code>{dispatch.refusalCode}</code></> : null}</p>)}
      {review.retirementAcks.map(ack => <p key={ack.id}><code>{ack.kind}</code> · <bdi>{ack.checkoutRef ?? ack.paymentRef}</bdi> · {date(ack.observedAt)}</p>)}
    </div></CardBody></Card>
    <Card><CardHeader title={t("merchantPayments.fees")} /><CardBody><div className="grid gap-2 text-sm">
      {review.feeOperations.map(operation => <p key={operation.id}>{money(operation.amountMinor, operation.currency)} · <code>{operation.status}</code> · <bdi>{operation.providerRef}</bdi></p>)}
      {review.feeObservations.map(fact => <p key={fact.id}>{money(fact.amountMinor, fact.currency)} · <bdi>{fact.providerRef}</bdi> · {date(fact.observedAt)}</p>)}
    </div></CardBody></Card>
    {review.hasMore && review.nextOffset !== null ? <a className="text-accent underline" href={`/admin/payments/${id}/merchant?offset=${review.nextOffset}`}>{t("common.next")}</a> : null}
  </div>;
}
