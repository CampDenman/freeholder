// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
// C12.38/C9.38: the exact future offer, tax and notice precede explicit consent.
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { formatMoney, translator } from "@/core/i18n";
import type { MerchantAmendmentReview, MerchantAmendmentStatus } from "@/modules/subscriptions/commercial-amendments";
import { Button, Callout, Field, Input, Select } from "@/ui/primitives";
import { InvoiceIssuer } from "../portal/invoices/InvoiceIssuer";
import { reviewCommercialAmendment, acceptCommercialAmendment, retryCommercialAmendment } from "../commercial-amendment-actions";
export function CommercialAmendment({ id, audience, locale, offered, status }: { id: string; audience: "owner" | "customer"; locale: string;
  offered: Array<{ id: string; name: string }>; status: MerchantAmendmentStatus }) {
  const t = translator(locale), router = useRouter(), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), [saved, setSaved] = useState(false);
  const [review, setReview] = useState<{ result: MerchantAmendmentReview; selection: Array<[string, string]> } | null>(null);
  async function load(form: FormData) {
    setBusy(true); setFailed(false); setReview(null);
    try {
      const localStart = form.get("resumeLocal");
      if (typeof localStart === "string" && localStart) {
        const start = new Date(localStart); if (!Number.isFinite(start.getTime())) { setFailed(true); return; }
        form.set("resumeAt", start.toISOString()); form.delete("resumeLocal");
      }
      const result = await reviewCommercialAmendment(form);
      if (result.failed || !result.review) { setFailed(true); return; }
      const selection: Array<[string, string]> = [];
      for (const [name, value] of form.entries()) if (typeof value === "string") selection.push([name, value]);
      setReview({ result: result.review, selection });
    } catch { setFailed(true); } finally { setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!busy) void load(new FormData(event.currentTarget)); }
  async function confirm(form: FormData) {
    setBusy(true); setFailed(false);
    try { const result = await acceptCommercialAmendment(form); setFailed(result.failed); if (!result.failed) { setSaved(true); setReview(null); router.refresh(); } }
    catch { setFailed(true); } finally { setBusy(false); }
  }
  async function retry() {
    setBusy(true); setFailed(false); const form = new FormData(); form.set("id", id); form.set("audience", audience);
    try { const result = await retryCommercialAmendment(form); setFailed(result.failed); if (!result.failed) router.refresh(); }
    catch { setFailed(true); } finally { setBusy(false); }
  }
  const accepted = status.accepted, result = review?.result, quote = result?.quote, snapshot = quote?.snapshot;
  const money = (amount: number) => formatMoney(amount, snapshot!.currency, locale);
  return <section className="mt-4 grid gap-4" aria-labelledby="commercial-amendment-title">
    <h2 id="commercial-amendment-title" className="text-lg font-semibold">{t("subscriptions.amendment.title")}</h2>
    {accepted ? <p role="status">{t(`subscriptions.amendment.${accepted.state}`, { name: accepted.name, date: new Date(accepted.effectivePeriodStart).toLocaleString(locale, { dateStyle: "medium", timeStyle: "long" }) })}</p> : null}
    {status.recoveryPending ? <p className="text-sm text-ink-muted">{t("subscriptions.amendment.recovery")}</p> : null}
    {accepted?.canRetry ? <div><Button type="button" disabled={busy} onClick={() => void retry()}>{t("subscriptions.amendment.retry")}</Button></div> : null}
    {saved ? <Callout tone="success">{t("subscriptions.amendment.saved")}</Callout> : null}
    {failed ? <Callout tone="danger">{t("subscriptions.amendment.failed")}</Callout> : null}
    {status.needsReconsent ? <p className="text-sm text-ink-muted">{t("subscriptions.resumption.intro")}</p> : null}
    {offered.length > 0 && (!accepted || status.needsReconsent) ? <form onSubmit={submit} onChange={() => setReview(null)} className="grid gap-3">
      <input type="hidden" name="id" value={id}/><input type="hidden" name="audience" value={audience}/><input type="hidden" name="locale" value={locale}/>
      <fieldset disabled={busy} className="grid gap-3"><legend className="mb-2 text-sm text-ink-muted">{t("subscriptions.amendment.intro")}</legend>
        {status.needsReconsent ? <Field label={t("subscriptions.resumption.start")} htmlFor="resumption-start"><Input id="resumption-start" name="resumeLocal" type="datetime-local" step="1" required/></Field> : null}
        <Field label={t("subscriptions.changePlan.choose")} htmlFor="amendment-plan"><Select id="amendment-plan" name="planId" required defaultValue=""><option value="">{t("subscriptions.changePlan.choose")}</option>{offered.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</Select></Field>
        <Field label={t("store.checkout.country")} htmlFor="amendment-country"><Input id="amendment-country" name="taxCountry" autoComplete="billing country" required minLength={2} maxLength={2} pattern="[A-Za-z]{2}"/></Field>
        <Field label={t("store.checkout.region")} htmlFor="amendment-region"><Input id="amendment-region" name="taxRegion" autoComplete="billing address-level1" maxLength={100}/></Field>
        <Field label={t("store.checkout.postalCode")} htmlFor="amendment-postal"><Input id="amendment-postal" name="taxPostalCode" autoComplete="billing postal-code" maxLength={32}/></Field>
        <Field label={t("store.checkout.city")} htmlFor="amendment-city"><Input id="amendment-city" name="taxCity" autoComplete="billing address-level2" maxLength={200}/></Field>
        <div><Button type="submit">{t(busy ? "memberships.reviewingCommercial" : "memberships.reviewCommercial")}</Button></div>
      </fieldset>
    </form> : null}
    <div aria-live="polite">{result && quote && snapshot && review ? <section className="grid gap-3 rounded-md border border-rule bg-surface p-4">
      <h3 className="font-semibold">{snapshot.name}</h3>
      <InvoiceIssuer issuer={{ issuerIsMerchant: true, issuerName: quote.issuer.name, issuerSupport: quote.issuer.support }} businessName="" locale={locale} t={t}/>
      <p>{t("subscriptions.amendment.effective", { date: new Date(result.effectivePeriodStart).toLocaleString(locale, { dateStyle: "medium", timeStyle: "long" }) })}</p>
      <p>{t("memberships.price", { amount: money(snapshot.periodAmountMinor), count: snapshot.intervalCount, interval: t(`memberships.interval.${snapshot.interval}`) })}</p>
      {snapshot.setupFeeMinor > 0 ? <p>{t("memberships.setupFee", { amount: money(snapshot.setupFeeMinor) })}</p> : null}
      <p>{t("memberships.initialQuotedTotal", { tax: money(quote.initialTaxQuote.taxMinor), total: money(quote.initialTaxQuote.totalMinor) })}</p>
      <p>{t(`memberships.cancel.${snapshot.cancelBehaviour}`)}</p><p>{t(snapshot.billingMode === "manual" ? "memberships.manual" : "memberships.automatic")}</p>
      <p className="whitespace-pre-wrap text-sm text-ink-muted">{quote.noticeSnapshot.text}</p><p className="text-sm text-ink-muted">{result.notice}</p>
      <form action={confirm} className="grid gap-3">{review.selection.map(([name, value]) => <input key={name} type="hidden" name={name} value={value}/>)}
        <input type="hidden" name="previousTermsId" value={result.previousTermsId}/><input type="hidden" name="acceptedQuoteDigest" value={result.quoteDigest}/>
        <label className="flex items-start gap-2"><input type="checkbox" name="confirm" value="yes" required disabled={busy}/><span>{t("subscriptions.amendment.confirm")}</span></label>
        <div><Button type="submit" disabled={busy}>{t("subscriptions.amendment.accept")}</Button></div>
      </form>
    </section> : null}</div>
  </section>;
}
