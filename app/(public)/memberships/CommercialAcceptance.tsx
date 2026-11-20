// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use client";
import { useState, type FormEvent } from "react";
import { formatMoney, translator } from "@/core/i18n";
import type { MembershipCommercialQuote } from "@/modules/subscriptions/public-signup";
import { Button, Callout, Field, Input, Select } from "@/ui/primitives";
import { InvoiceIssuer } from "../../portal/invoices/InvoiceIssuer";
import { joinMembershipAction, reviewMembershipAction } from "./actions";

type Selection={taxCountry:string;taxRegion:string;taxPostalCode:string;taxCity:string;paymentMethodId:string};
export function CommercialAcceptance({planId,requestKey,locale,methods}:{planId:string;requestKey:string;locale:string;methods:Array<{id:string;label:string}>}){
  const t=translator(locale),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
  const [review,setReview]=useState<{quote:MembershipCommercialQuote;selection:Selection}|null>(null);
  async function load(form:FormData){
    setBusy(true);setReview(null);setFailed(false);
    try{
      const result=await reviewMembershipAction(form);
      if(result.failed||!result.quote){setFailed(true);return;}
      const text=(key:string)=>{const value=form.get(key);return typeof value==="string"?value.trim():"";};
      setReview({quote:result.quote,selection:{taxCountry:text("taxCountry"),taxRegion:text("taxRegion"),taxPostalCode:text("taxPostalCode"),taxCity:text("taxCity"),paymentMethodId:text("paymentMethodId")}});
    }catch{setFailed(true);}finally{setBusy(false);}
  }
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!busy)void load(new FormData(event.currentTarget));}
  const quote=review?.quote,snapshot=quote?.snapshot;
  const money=(amount:number)=>formatMoney(amount,snapshot!.currency,locale);
  const needsCard=!!snapshot&&snapshot.trialDays>0&&snapshot.trialRequiresCard&&!review?.selection.paymentMethodId&&quote?.initialTaxQuote.totalMinor===0;
  return <div className="grid gap-6">
    <form onSubmit={submit} onChange={()=>setReview(null)} className="grid gap-4">
      <input type="hidden" name="planId" value={planId}/>
      <fieldset disabled={busy} className="grid gap-4">
        <legend className="mb-3 font-semibold">{t("store.checkout.billingTaxLegend")}</legend>
        <p className="text-sm text-ink-muted">{t("memberships.commercialReviewHint")}</p>
        <Field label={t("store.checkout.country")} htmlFor="membership-country"><Input id="membership-country" name="taxCountry" autoComplete="billing country" required minLength={2} maxLength={2} pattern="[A-Za-z]{2}"/></Field>
        <Field label={t("store.checkout.region")} htmlFor="membership-region"><Input id="membership-region" name="taxRegion" autoComplete="billing address-level1" maxLength={100}/></Field>
        <Field label={t("store.checkout.postalCode")} htmlFor="membership-postal"><Input id="membership-postal" name="taxPostalCode" autoComplete="billing postal-code" maxLength={32}/></Field>
        <Field label={t("store.checkout.city")} htmlFor="membership-city"><Input id="membership-city" name="taxCity" autoComplete="billing address-level2" maxLength={200}/></Field>
        {methods.length?<Field label={t("memberships.paymentMethod")} htmlFor="membership-method"><Select id="membership-method" name="paymentMethodId" defaultValue=""><option value="">{t("memberships.chooseMethodNext")}</option>{methods.map(method=><option key={method.id} value={method.id}>{method.label}</option>)}</Select></Field>:null}
        <div><Button type="submit" disabled={busy}>{t(busy?"memberships.reviewingCommercial":"memberships.reviewCommercial")}</Button></div>
      </fieldset>
    </form>
    {failed?<Callout tone="danger">{t("memberships.failed")}</Callout>:null}
    <div aria-live="polite">{review&&quote&&snapshot?<section aria-labelledby="accepted-membership-terms" className="grid gap-4 rounded-lg border border-rule bg-surface p-5">
      <h2 id="accepted-membership-terms" className="text-xl font-semibold">{snapshot.name}</h2>
      <InvoiceIssuer issuer={{issuerIsMerchant:true,issuerName:quote.issuer.name,issuerSupport:quote.issuer.support}} businessName="" locale={locale} t={t}/>
      <p>{t("memberships.price",{amount:money(snapshot.periodAmountMinor),count:snapshot.intervalCount,interval:t(`memberships.interval.${snapshot.interval}`)})}</p>
      {snapshot.setupFeeMinor>0?<p>{t("memberships.setupFee",{amount:money(snapshot.setupFeeMinor)})}</p>:null}
      {snapshot.trialDays>0?<p>{t("memberships.trial",{days:snapshot.trialDays})}</p>:null}
      <p>{t(`memberships.cancel.${snapshot.cancelBehaviour}`)}</p>
      <p>{t(snapshot.billingMode==="manual"?"memberships.manual":"memberships.automatic")}</p>
      <p>{t("memberships.initialQuotedTotal",{tax:money(quote.initialTaxQuote.taxMinor),total:money(quote.initialTaxQuote.totalMinor)})}</p>
      <p>{t("memberships.firstPaidEstimate",{tax:money(quote.firstPeriodTaxQuote.taxMinor),total:money(quote.firstPeriodTaxQuote.totalMinor)})}</p>
      <p className="text-sm text-ink-muted">{quote.noticeSnapshot.text}</p>
      <form action={joinMembershipAction} className="grid gap-4">
        <input type="hidden" name="planId" value={quote.planId}/><input type="hidden" name="requestKey" value={requestKey}/>
        <input type="hidden" name="termsHash" value={quote.publicTermsHash}/><input type="hidden" name="commercialQuoteDigest" value={quote.quoteDigest}/>
        {Object.entries(review.selection).map(([name,value])=><input key={name} type="hidden" name={name} value={value}/>)}
        {needsCard?<><p>{t("memberships.cardNeeded")}</p><label className="flex items-start gap-2"><input type="checkbox" name="saveMethodConsent" value="yes" required/><span>{t("memberships.saveConsent")}</span></label></>:null}
        <label className="flex items-start gap-2"><input type="checkbox" name="acceptedTerms" value="yes" required/><span>{t("memberships.acceptCommercial")}</span></label>
        <div><Button type="submit">{t(needsCard?"memberships.saveCard":"memberships.join")}</Button></div>
      </form>
    </section>:null}</div>
  </div>;
}
