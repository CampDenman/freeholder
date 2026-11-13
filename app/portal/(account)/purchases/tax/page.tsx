// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: the customer's own request, without arbitrary email/contact lookup.
import type {Metadata} from "next";
import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {SESSION_COOKIE} from "@/core/auth/sessions";
import {actorFromToken} from "@/core/http/actor";
import {ServiceError} from "@/core/service";
import {cartMerchantTaxBusinesses,myMerchantTaxExemptions} from "@/modules/invoicing/merchant-tax-exemptions";
import {Button,Callout,Card,CardBody,CardHeader,Field,Input,Select} from "@/ui/primitives";
import {readShopperCart} from "../../../../(public)/shopper-cart";
import {getLocale,getT} from "../../../../i18n";
import {requestCustomerTaxExemptionAction,withdrawCustomerTaxExemptionAction} from "./actions";
type Query={offset?:string;error?:string;requested?:string;withdrawn?:string};
export const dynamic="force-dynamic";
export async function generateMetadata():Promise<Metadata>{return{title:(await getT())("merchantTax.exemption.title"),robots:{index:false,follow:false}};}
export default async function CustomerTaxExemptionsPage({searchParams}:{searchParams:Promise<Query>}){
 const[t,locale,jar,query,credential]=await Promise.all([getT(),getLocale(),cookies(),searchParams,readShopperCart()]);
 const actor=await actorFromToken(jar.get(SESSION_COOKIE)?.value);
 if(actor.kind!=="user")redirect("/login?returnTo=/portal/purchases/tax");
 const requestedOffset=Number(query.offset??0),offset=Number.isInteger(requestedOffset)&&requestedOffset>=0&&requestedOffset<=100000?requestedOffset:0;
 let requests:Awaited<ReturnType<typeof myMerchantTaxExemptions.call>>|null=null;
 let businesses:Awaited<ReturnType<typeof cartMerchantTaxBusinesses.call>>=[];
 let unavailable=false;
 try{requests=await myMerchantTaxExemptions.call({offset,limit:20},actor);}catch(error){if(!(error instanceof ServiceError)||!["permission","conflict","not_found"].includes(error.code))throw error;unavailable=true;}
 if(credential&&!unavailable)try{businesses=await cartMerchantTaxBusinesses.call({cartId:credential.cartId,cartToken:credential.token},actor);}catch(error){if(!(error instanceof ServiceError)||!["permission","conflict","not_found"].includes(error.code))throw error;unavailable=true;}
 const date=new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short",timeZone:"UTC"});
 return <div className="grid gap-6">
  <div><a className="text-sm underline" href="/cart">{t("merchantTax.exemption.backToCart")}</a><h1 className="mt-3 text-2xl font-semibold">{t("merchantTax.exemption.title")}</h1><p className="mt-3 text-sm text-ink-muted">{t("merchantTax.exemption.intro")}</p></div>
  {query.error?<Callout tone="danger">{t("merchantTax.exemption.requestError")}</Callout>:null}
  {query.requested?<Callout tone="success">{t("merchantTax.exemption.requested")}</Callout>:null}
  {query.withdrawn?<Callout tone="success">{t("merchantTax.exemption.withdrawn")}</Callout>:null}
  {unavailable?<Callout>{t("merchantTax.exemption.unavailable")}</Callout>:null}
  {!credential?<Callout>{t("merchantTax.exemption.noCart")}</Callout>:null}
  {businesses.length?<Card><CardHeader title={t("merchantTax.exemption.request")}/><CardBody><form action={requestCustomerTaxExemptionAction} className="grid gap-4">
   <Field label={t("merchantTax.exemption.business")} htmlFor="customer-tax-business"><Select id="customer-tax-business" name="business" required defaultValue=""><option value="" disabled>{t("merchantTax.exemption.chooseBusiness")}</option>{businesses.map(business=><option key={business.sellerUserId??"site"} value={business.sellerUserId??"site"}>{business.merchantName}</option>)}</Select></Field>
   <fieldset className="grid gap-3 rounded-md border border-rule p-4 sm:grid-cols-2"><legend className="px-1 text-sm font-medium">{t("merchantTax.exemption.destination")}</legend>
    <Field label={t("merchantTax.country")} htmlFor="customer-tax-country"><Input id="customer-tax-country" name="country" required minLength={2} maxLength={2} pattern="[A-Za-z]{2}" autoComplete="country"/></Field>
    <Field label={t("merchantTax.region")} htmlFor="customer-tax-region"><Input id="customer-tax-region" name="region" maxLength={100} autoComplete="address-level1"/></Field>
    <Field label={t("merchantTax.postalCode")} htmlFor="customer-tax-postal"><Input id="customer-tax-postal" name="postalCode" maxLength={30} autoComplete="postal-code"/></Field>
    <Field label={t("merchantTax.city")} htmlFor="customer-tax-city"><Input id="customer-tax-city" name="city" maxLength={200} autoComplete="address-level2"/></Field>
   </fieldset>
   <Field label={t("tax.exemption.kind")} htmlFor="customer-tax-kind"><Select id="customer-tax-kind" name="kind" required defaultValue=""><option value="" disabled>{t("merchantTax.choose")}</option>{["reseller","nonprofit","reverse_charge","diplomatic"].map(kind=><option key={kind} value={kind}>{t(`tax.exemption.kind.${kind}`)}</option>)}</Select></Field>
   <Field label={t("merchantTax.exemption.evidence")} htmlFor="customer-tax-evidence" hint={t("merchantTax.exemption.customerHint")}><Input id="customer-tax-evidence" name="certificateRef" required minLength={3} maxLength={500} autoComplete="off"/></Field>
   <div><Button type="submit">{t("merchantTax.exemption.request")}</Button></div>
  </form></CardBody></Card>:null}
  <Card><CardHeader title={t("merchantTax.exemption.yourRequests")}/><CardBody>
   {requests?.rows.length?<ul className="grid list-none gap-4 p-0">{requests.rows.map(row=><li key={row.id} className="min-w-0 rounded-md border border-rule p-4 text-sm">
    <p className="font-medium">{row.businessName??t("merchantTax.exemption.businessUnavailable")} · {row.zoneName}</p><p>{t(`tax.exemption.kind.${row.kind}`)} · {t(`tax.exemption.status.${row.status==="valid"&&row.expiresAt&&row.expiresAt<new Date()?"expired":row.status}`)}</p>
    <p className="mt-2 break-words whitespace-pre-wrap"><bdi>{row.certificateRef??t("merchantTax.exemption.noEvidence")}</bdi></p>
    {row.expiresAt?<p className="mt-1 text-xs text-ink-muted">{t("merchantTax.exemption.expiryUtc")}: <bdi>{date.format(row.expiresAt)}</bdi></p>:null}
    {row.status==="pending"?<form action={withdrawCustomerTaxExemptionAction} className="mt-3"><input type="hidden" name="id" value={row.id}/><Button type="submit" variant="quiet">{t("merchantTax.exemption.withdraw")}</Button></form>:null}
   </li>)}</ul>:<p className="text-sm text-ink-muted">{t("tax.exemptions.empty")}</p>}
   {requests?.nextOffset!==null&&requests?.nextOffset!==undefined?<a className="mt-4 inline-block text-sm underline" href={`/portal/purchases/tax?offset=${requests.nextOffset}`}>{t("merchantTax.exemption.more")}</a>:null}
  </CardBody></Card>
  <div><a className="text-sm underline" href="/checkout">{t("merchantTax.exemption.continueCheckout")}</a></div>
 </div>;
}
