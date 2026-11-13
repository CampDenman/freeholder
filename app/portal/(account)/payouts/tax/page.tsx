// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: the seller's deliberate tax business, without another seller's data.
import type {Metadata} from "next";
import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {SESSION_COOKIE} from "@/core/auth/sessions";
import {actorFromToken} from "@/core/http/actor";
import {ServiceError} from "@/core/service";
import {Callout} from "@/ui/primitives";
import {loadMerchantTaxEditor,MerchantTaxEditor,type MerchantTaxEditorQuery} from "@/ui/MerchantTaxEditor";
import {getLocale,getT} from "../../../../i18n";
import {saveMemberTaxAction,reviewMemberTaxExemptionAction} from "./actions";
export const dynamic="force-dynamic";
export async function generateMetadata():Promise<Metadata>{return{title:(await getT())("merchantTax.title"),robots:{index:false,follow:false}};}
export default async function MemberTaxPage({searchParams}:{searchParams:Promise<MerchantTaxEditorQuery>}){
 const[t,locale,jar,query]=await Promise.all([getT(),getLocale(),cookies(),searchParams]);
 const actor=await actorFromToken(jar.get(SESSION_COOKIE)?.value);
 if(actor.kind!=="user")redirect("/login?returnTo=/portal/payouts/tax");
 let data:Awaited<ReturnType<typeof loadMerchantTaxEditor>>;
 try{data=await loadMerchantTaxEditor(actor,false,query);}catch(error){
  if(!(error instanceof ServiceError)||!["permission","conflict"].includes(error.code))throw error;
  return<div className="grid gap-4"><a href="/portal/payouts" className="text-sm underline">{t("merchantTax.backToPayouts")}</a><h1 className="text-2xl font-semibold">{t("merchantTax.title")}</h1><Callout>{t(`merchantTax.error.${error.code}`)}</Callout></div>;
 }
 return<div className="grid gap-6"><div><a href="/portal/payouts" className="text-sm underline">{t("merchantTax.backToPayouts")}</a><h1 className="mt-3 text-2xl font-semibold">{t("merchantTax.title")}</h1></div><MerchantTaxEditor data={data} query={query} path="/portal/payouts/tax" site={false} action={saveMemberTaxAction} reviewAction={reviewMemberTaxExemptionAction} t={t} locale={locale}/></div>;
}
