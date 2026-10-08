// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { formatMoney } from "@/core/i18n";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { currentBusiness } from "@/core/settings/read";
import { myMembershipPaymentMethods, publicMembershipPlans } from "@/modules/subscriptions/public-signup";
import { Button, Callout, Field, Select } from "@/ui/primitives";
import { getLocale, getT } from "../../i18n";
import { joinMembershipAction } from "./actions";
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> { return {title:(await getT())("memberships.title")}; }
export default async function Memberships({searchParams}:{searchParams:Promise<{error?:string}>}) {
  const [t,locale,business,jar,q] = await Promise.all([getT(),getLocale(),currentBusiness(),cookies(),searchParams]);
  const actor=await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  const plans=await publicMembershipPlans.call({},actor);
  const methods=actor.kind==="user"?await myMembershipPaymentMethods.call({},actor).catch(()=>[]):[];
  const href=(path:string)=>business?localizeCustomerHref(path,locale,business):path;
  return <div className="mx-auto grid max-w-4xl gap-6 px-6 py-12"><h1 className="text-3xl font-semibold">{t("memberships.title")}</h1><p>{t("memberships.intro")}</p>{q.error?<Callout tone="danger">{t("memberships.failed")}</Callout>:null}{plans.length?<div className="grid gap-6 md:grid-cols-2">{plans.map(plan=>{
    const needsCard=plan.trialDays>0&&plan.trialRequiresCard&&methods.length===0;
    return <article key={plan.id} className="grid content-start gap-4 rounded-lg border border-rule bg-surface p-6"><h2 className="text-xl font-semibold">{plan.name}</h2>{plan.description?<p className="text-ink-muted">{plan.description}</p>:null}<p className="text-xl">{t("memberships.price",{amount:formatMoney(plan.amountMinor,plan.currency,locale),count:plan.intervalCount,interval:t(`memberships.interval.${plan.interval}`)})}</p>{plan.setupFeeMinor>0?<p>{t("memberships.setupFee",{amount:formatMoney(plan.setupFeeMinor,plan.currency,locale)})}</p>:null}{plan.trialDays>0?<p>{t("memberships.trial",{days:plan.trialDays})}</p>:null}<p>{t(`memberships.cancel.${plan.cancelBehaviour}`)}</p><p className="text-sm text-ink-muted">{t(plan.billingMode==="manual"?"memberships.manual":"memberships.automatic")}</p>{!plan.available?<Callout>{t("memberships.unavailable")}</Callout>:actor.kind!=="user"?<a className="underline" href={href("/portal/login?returnTo=%2Fmemberships")}>{t("memberships.signIn")}</a>:needsCard?<Callout>{t("memberships.cardNeeded")}</Callout>:<form action={joinMembershipAction} className="grid gap-3"><input type="hidden" name="planId" value={plan.id}/><input type="hidden" name="termsHash" value={plan.termsHash}/><input type="hidden" name="requestKey" value={randomUUID()}/>{plan.billingMode!=="manual"&&methods.length?<Field label={t("memberships.paymentMethod")} htmlFor={`method-${plan.id}`}><Select id={`method-${plan.id}`} name="paymentMethodId" defaultValue={methods[0]?.id}>{methods.map(method=><option key={method.id} value={method.id}>{method.label}</option>)}</Select></Field>:null}<label className="flex items-start gap-2"><input type="checkbox" name="acceptedTerms" value="yes" required/><span>{t("memberships.accept")}</span></label><Button type="submit">{t("memberships.join")}</Button></form>}</article>;
  })}</div>:<Callout>{t("memberships.empty")}</Callout>}<a className="underline" href={href("/portal/subscriptions")}>{t("memberships.manage")}</a></div>;
}
