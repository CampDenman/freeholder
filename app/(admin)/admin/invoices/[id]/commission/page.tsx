// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { formatMoney } from "@/core/i18n";
import { hasModuleAccess, ServiceError } from "@/core/service";
import { reviewAgreementFee } from "@/modules/invoicing/agreement-fee-service";
import { Button, Callout, Card, CardBody, CardHeader, Field, Input, Select } from "@/ui/primitives";
import { getLocale, getT } from "../../../../../i18n";
import { requireStaffActor } from "../../../guard";
import { recordAgreementFeeAction } from "./actions";
export const dynamic = "force-dynamic";

export default async function AgreementCommissionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { id } = await params, query = await searchParams;
  const actor = await requireStaffActor("invoicing");
  let review;
  try { review = await reviewAgreementFee.call({ invoiceId: id }, actor); }
  catch (error) { if (error instanceof ServiceError && error.code === "not_found") notFound(); throw error; }
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const money = (minor: number) => formatMoney(minor, review.currency, locale);
  const canManage = hasModuleAccess(actor, "invoicing", "manage"), stepUpValid = actor.kind === "user" && actor.security?.stepUpValid !== false;
  const feeRemaining = review.owedMinor !== null && review.recordedMinor !== null ? review.owedMinor - review.recordedMinor : 0;
  const remittances = review.receipts.filter(row => row.direction === "remitted");
  return <div className="grid gap-5">
    <h1 className="text-xl font-bold">{t("agreementCommission.title")}</h1>
    <p className="max-w-prose text-sm text-ink-muted">{t("agreementCommission.notice")}</p>
    {query.error ? <Callout tone="danger">{t("commercialRecorded.error")}</Callout> : null}
    {query.saved ? <Callout>{t("commercialRecorded.saved")}</Callout> : null}
    <Card><CardHeader title={t("agreementCommission.expected")} /><CardBody><div className="grid gap-3">
      <p className="font-semibold">{money(review.expectedReceivableMinor)}</p>
      <p>{t(review.eligible ? "agreementCommission.realized" : "agreementCommission.pending")}</p>
      <dl className="grid gap-2"><div><dt>{t("commercialRecorded.feeOwed")}</dt><dd>{review.owedMinor === null ? t("commercialRecorded.principalReview") : money(review.owedMinor)}</dd></div><div><dt>{t("commercialRecorded.feeRecorded")}</dt><dd>{review.recordedMinor === null ? t("commercialRecorded.principalReview") : money(review.recordedMinor)}</dd></div></dl>
      {review.reviewRequired ? <Callout tone="warning">{t("commercialRecorded.review")}</Callout> : null}
      <a className="text-accent underline" href={`/admin/invoices/${review.invoiceId}`}>{t("commercialRecorded.invoice")}</a>
    </div></CardBody></Card>
    <Card><CardHeader title={t("commercialRecorded.receipts")} /><CardBody><div className="grid gap-3">
      {!review.receipts.length ? <p>{t("commercialRecorded.empty")}</p> : review.receipts.map(receipt => <p key={receipt.id}><bdi>{receipt.id}</bdi> · {t(`commercialRecorded.${receipt.direction}`)} · {money(receipt.amountMinor)}</p>)}
      {canManage && !stepUpValid ? <Callout><a className="text-accent underline" href={`/security/verify?returnTo=${encodeURIComponent(`/admin/invoices/${id}/commission`)}`}>{t("commercialRecorded.verify")}</a></Callout> : null}
      {canManage && stepUpValid && review.eligible && !review.reviewRequired ? <>
        {feeRemaining > 0 ? <form action={recordAgreementFeeAction} className="grid gap-3">
          <input type="hidden" name="invoiceId" value={id} /><input type="hidden" name="direction" value="remitted" /><input type="hidden" name="idempotencyKey" value={`commercial-fee:${randomUUID()}`} />
          <p>{t("commercialRecorded.remaining", { amount: money(feeRemaining) })}</p>
          <Field label={t("payments.amount")} htmlFor="fee-amount"><Input id="fee-amount" name="amount" inputMode="decimal" required /></Field>
          <Field label={t("commercialRecorded.reference")} htmlFor="fee-reference"><Input id="fee-reference" name="reference" maxLength={300} required /></Field>
          <Field label={t("commercialRecorded.evidence")} htmlFor="fee-evidence"><Input id="fee-evidence" name="evidence" minLength={3} maxLength={1000} required /></Field>
          <label><input type="checkbox" name="confirm" value="yes" required /> {t("commercialRecorded.confirm")}</label><Button type="submit">{t("commercialRecorded.recordRemittance")}</Button>
        </form> : null}
        {remittances.length ? <form action={recordAgreementFeeAction} className="grid gap-3 border-t border-rule pt-4">
          <input type="hidden" name="invoiceId" value={id} /><input type="hidden" name="direction" value="returned" /><input type="hidden" name="idempotencyKey" value={`commercial-fee-return:${randomUUID()}`} />
          <Field label={t("commercialRecorded.originalRemittance")} htmlFor="original-remittance"><Select id="original-remittance" name="originalRemittanceId" required>{remittances.map(receipt => <option key={receipt.id} value={receipt.id}>{receipt.id} · {money(receipt.amountMinor)}</option>)}</Select></Field>
          <Field label={t("payments.amount")} htmlFor="return-amount"><Input id="return-amount" name="amount" inputMode="decimal" required /></Field>
          <Field label={t("commercialRecorded.reference")} htmlFor="return-reference"><Input id="return-reference" name="reference" maxLength={300} required /></Field>
          <Field label={t("commercialRecorded.evidence")} htmlFor="return-evidence"><Input id="return-evidence" name="evidence" minLength={3} maxLength={1000} required /></Field>
          <label><input type="checkbox" name="confirm" value="yes" required /> {t("commercialRecorded.confirm")}</label><Button type="submit" variant="quiet">{t("commercialRecorded.recordReturn")}</Button>
        </form> : null}
      </> : null}
    </div></CardBody></Card>
  </div>;
}
