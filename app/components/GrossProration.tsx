// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// C9.33/C9.38/C12.38: one reviewed gross-money promise for both human audiences.
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { formatMoney, translator } from "@/core/i18n";
import type { GrossProrationReview } from "@/modules/subscriptions/proration-quote";
import type { GrossProrationStatus } from "@/modules/subscriptions/proration-service";
import { Button, Callout, Field, Input, Select } from "@/ui/primitives";
import { InvoiceIssuer } from "../portal/invoices/InvoiceIssuer";
import { confirmGrossProration, reviewGrossProration } from "../gross-proration-actions";
export function GrossProration({ id, audience, locale, offered, status }: { id: string; audience: "owner" | "customer"; locale: string; offered: Array<{ id: string; name: string }>; status: GrossProrationStatus }) {
  const t = translator(locale), router = useRouter(), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), [saved, setSaved] = useState(false);
  const [review, setReview] = useState<{ result: GrossProrationReview; selection: Array<[string, string]> } | null>(null);
  async function load(form: FormData) {
    setBusy(true); setFailed(false); setReview(null);
    try {
      const local = form.get("effectiveLocal"), date = typeof local === "string" ? new Date(local) : null;
      if (!date || !Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) { setFailed(true); return; }
      form.set("effectiveAt", date.toISOString()); form.delete("effectiveLocal");
      const result = await reviewGrossProration(form); if (result.failed || !result.review) { setFailed(true); return; }
      const selection: Array<[string, string]> = [];
      for (const [key, value] of form.entries()) if (typeof value === "string") selection.push([key, value]);
      setReview({ result: result.review, selection });
    } catch { setFailed(true); } finally { setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!busy) void load(new FormData(event.currentTarget)); }
  async function confirm(form: FormData) {
    setBusy(true); setFailed(false);
    try { const result = await confirmGrossProration(form); setFailed(result.failed); if (!result.failed) { setSaved(true); setReview(null); router.refresh(); } }
    catch { setFailed(true); } finally { setBusy(false); }
  }
  const accepted = status.accepted, result = review?.result, snapshot = result?.quote.snapshot;
  const money = (minor: number, currency = snapshot?.currency ?? accepted?.currency ?? "USD") => formatMoney(minor, currency, locale);
  const date = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "long" });
  const canReview = !accepted || ["applied", "cancelled"].includes(accepted.state);
  return <section className="mt-4 grid gap-4" aria-labelledby="gross-proration-title">
    <h2 id="gross-proration-title" className="text-lg font-semibold">{t("subscriptions.proration.title")}</h2>
    <p className="text-sm text-ink-muted">{t("subscriptions.proration.intro")}</p>
    {failed ? <Callout tone="danger">{t("subscriptions.proration.failed")}</Callout> : null}
    {saved ? <Callout tone="success">{t("subscriptions.proration.saved")}</Callout> : null}
    {accepted ? <div className="grid gap-2" role="status">
      <p>{t(`subscriptions.proration.state.${accepted.state}`)}</p><p>{t("subscriptions.proration.effective", { date: date(accepted.effectiveAt) })}</p>
      {accepted.remainingMinor !== null ? <p>{t("subscriptions.proration.remaining", { amount: money(accepted.remainingMinor) })}</p> : null}
      {accepted.needsFreshConsent ? <Callout tone="warning">{t("subscriptions.proration.recovery")}</Callout> : null}
      {accepted.invoiceId ? <a className="text-accent underline" href={`${audience === "owner" ? "/admin" : "/portal"}/invoices/${accepted.invoiceId}`}>{t("subscriptions.prorationInvoice")}</a> : null}
    </div> : null}
    {canReview && offered.length ? <form onSubmit={submit} onChange={() => setReview(null)} className="grid gap-3">
      <input type="hidden" name="id" value={id}/><input type="hidden" name="audience" value={audience}/><input type="hidden" name="locale" value={locale}/>
      <fieldset disabled={busy} className="grid gap-3"><legend className="mb-2 text-sm">{t("subscriptions.proration.choose")}</legend>
        <Field label={t("subscriptions.changePlan.choose")} htmlFor="gross-plan"><Select id="gross-plan" name="planId" required defaultValue=""><option value="">{t("subscriptions.changePlan.choose")}</option>{offered.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</Select></Field>
        <Field label={t("subscriptions.proration.start")} htmlFor="gross-effective"><Input id="gross-effective" type="datetime-local" name="effectiveLocal" step="1" required/></Field>
        <p className="text-sm text-ink-muted">{t("subscriptions.proration.startHint")}</p>
        <Field label={t("store.checkout.country")} htmlFor="gross-country"><Input id="gross-country" name="taxCountry" autoComplete="billing country" minLength={2} maxLength={2} pattern="[A-Za-z]{2}" required/></Field>
        <Field label={t("store.checkout.region")} htmlFor="gross-region"><Input id="gross-region" name="taxRegion" autoComplete="billing address-level1" maxLength={100}/></Field>
        <Field label={t("store.checkout.postalCode")} htmlFor="gross-postal"><Input id="gross-postal" name="taxPostalCode" autoComplete="billing postal-code" maxLength={32}/></Field>
        <Field label={t("store.checkout.city")} htmlFor="gross-city"><Input id="gross-city" name="taxCity" autoComplete="billing address-level2" maxLength={200}/></Field>
        <div><Button type="submit">{t(busy ? "memberships.reviewingCommercial" : "memberships.reviewCommercial")}</Button></div>
      </fieldset>
    </form> : null}
    <div aria-live="polite">{result && snapshot && review ? <div className="grid gap-3 rounded-md border border-rule bg-surface p-4">
      <h3 className="font-semibold">{snapshot.name}</h3><InvoiceIssuer issuer={{ issuerIsMerchant: true, issuerName: result.quote.issuer.name, issuerSupport: result.quote.issuer.support }} businessName="" locale={locale} t={t}/>
      <p>{t("subscriptions.proration.effective", { date: date(result.effectiveAt) })}</p>
      <p>{t("subscriptions.proration.calendar", { date: date(result.originalPeriodEnd) })}</p>
      <dl className="grid gap-2 text-sm">{([ ["newDebit", result.debitNetMinor + result.debitTaxMinor], ["oldCredit", result.creditNetMinor + result.creditTaxMinor], ["applied", result.creditAppliedMinor], ["cash", result.cashDueMinor], ["residual", result.residualCreditMinor] ] as const).map(([key, amount]) => <div key={key} className="flex justify-between gap-4"><dt>{t(`subscriptions.proration.${key}`)}</dt><dd className="font-mono">{money(amount)}</dd></div>)}</dl>
      {result.originalTrialEndsAt ? <Callout>{t("subscriptions.proration.trial", { date: date(result.originalTrialEndsAt) })}</Callout> : null}
      {result.feeReview ? <div className="grid gap-2 text-sm"><p>{t("subscriptions.proration.feeCarry", { amount: money(result.feeReview.appliedFeeObligationMinor), proved: money(result.feeReview.appliedFeeProvenCollectedMinor) })}</p>
        {result.feeReview.separateMerchantReceivableMinor > 0 ? <p>{t("subscriptions.proration.feeReceivable", { amount: money(result.feeReview.separateMerchantReceivableMinor) })}</p> : null}
        {result.feeReview.originalSourceDebt || result.feeReview.originalOverTargetMinor > 0 ? <Callout tone="warning">{t("subscriptions.proration.feeDebt")}</Callout> : null}</div> : null}
      {result.requiresMerchantReview ? <Callout tone="warning">{t("subscriptions.proration.merchantReview")}</Callout> : null}
      <p className="whitespace-pre-wrap text-sm text-ink-muted">{result.noticeSnapshot.text}</p>
      <form action={confirm} className="grid gap-3">{review.selection.map(([name, value]) => <input key={name} type="hidden" name={name} value={value}/>)}
        <input type="hidden" name="previousTermsId" value={result.previousTermsId}/><input type="hidden" name="acceptedQuoteDigest" value={result.quoteDigest}/>
        <label className="flex items-start gap-2"><input type="checkbox" name="confirm" value="yes" required disabled={busy || result.requiresMerchantReview}/><span>{t("subscriptions.proration.confirm")}</span></label>
        <div><Button type="submit" disabled={busy || result.requiresMerchantReview}>{t("subscriptions.amendment.accept")}</Button></div>
      </form>
    </div> : null}</div>
  </section>;
}
