// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: deliberate human business declarations through the shared services.
import {randomUUID} from "node:crypto";
import {minorToDecimal} from "@/adapters/payments/currency";
import type {TaxAddress} from "@/adapters/tax";
import type {PublicMerchantSupport} from "@/core/commerce/merchant-identity";
import type {Translate} from "@/core/i18n";
import type {MerchantTaxRuleSnapshot} from "@/modules/invoicing/merchant-tax-contract";
import {Button,Callout,Field,Input,Select} from "@/ui/primitives";

export type MerchantTaxFormZone=MerchantTaxRuleSnapshot["zone"]&{configurationDigest:string;activationLimitation:string|null;rates:MerchantTaxRuleSnapshot["rates"]};
export type MerchantTaxFormProfile={profileVersion:number;state:"active"|"erased";configuration:{origin:TaxAddress;liability:"platform"|"seller";collectionStatus:"registered"|"not_registered";nonCollectionReason:string|null;merchantName:string|null;merchantSupport:PublicMerchantSupport|null;rulesSnapshot:MerchantTaxRuleSnapshot[]}|null}|null;
export function MerchantTaxForm({profile,zones,site,action,t,locale,canManage=true}:{profile:MerchantTaxFormProfile;zones:MerchantTaxFormZone[];site:boolean;action:(data:FormData)=>Promise<void>;t:Translate;locale:string;canManage?:boolean}){
 const config=profile?.configuration,origin=config?.origin,support=config?.merchantSupport;
 const rows=zones.flatMap(zone=>zone.rates.filter(rate=>rate.active||config?.rulesSnapshot.some(saved=>saved.registrations.some(registration=>registration.rateIds.includes(rate.id)))).map(rate=>({zone,rate,declaration:config?.rulesSnapshot.find(saved=>saved.zone.id===zone.id)?.registrations.find(registration=>registration.rateIds.includes(rate.id))})));
 const blocked=!canManage||profile?.state==="erased"||rows.length>1000;
 const textField=(name:string,label:string,value:string|null|undefined,maxLength:number,required=false,type="text")=><Field key={name} label={t(label)} htmlFor={`tax-${name}`}><Input id={`tax-${name}`} name={name} defaultValue={value??""} maxLength={maxLength} required={required} type={name.endsWith(".threshold")?"number":type} step={name.endsWith(".threshold")?"any":undefined} min={name.endsWith(".threshold")?0:undefined} autoComplete="off"/></Field>;
 return <form action={action} className="grid gap-6">
  <input type="hidden" name="expectedVersion" value={profile?.profileVersion??0}/>
  <input type="hidden" name="idempotencyKey" value={randomUUID()}/>
  <input type="hidden" name="rateCount" value={rows.length}/>
  {profile?.state==="erased"?<Callout>{t("merchantTax.erased")}</Callout>:null}
  {rows.length>1000?<Callout tone="danger">{t("merchantTax.tooManyRates")}</Callout>:null}
  <fieldset disabled={blocked} className="grid min-w-0 gap-6">
   <legend className="mb-3 font-semibold">{t("merchantTax.businessOrigin")}</legend>
   <p className="text-sm text-ink-muted">{t(site?"merchantTax.siteIntro":"merchantTax.memberIntro")}</p>
   <div className="grid gap-3 sm:grid-cols-2">
    {textField("origin.country","merchantTax.country",origin?.country,2,true)}
    {textField("origin.region","merchantTax.region",origin?.region,100)}
    {textField("origin.postalCode","merchantTax.postalCode",origin?.postalCode,30)}
    {textField("origin.city","merchantTax.city",origin?.city,200)}
   </div>
   {site?<fieldset className="grid min-w-0 gap-3 rounded-md border border-rule p-4">
    <legend className="px-1 font-medium">{t("merchantTax.publicBusiness")}</legend>
    <p className="text-sm text-ink-muted">{t("merchantTax.publicBusinessHint")}</p>
    {textField("merchantName","merchantTax.businessName",config?.merchantName,200,true)}
    <div className="grid gap-3 sm:grid-cols-2">
     {textField("support.email","merchantTax.supportEmail",support?.email,254,false,"email")}
     {textField("support.phone","merchantTax.supportPhone",support?.phone,60,false,"tel")}
     {textField("support.url","merchantTax.supportUrl",support?.url,2048,false,"url")}
    </div>
    <details><summary className="cursor-pointer text-sm font-medium">{t("merchantTax.publicAddress")}</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">
     {textField("support.line1","merchantTax.street",support?.address?.line1,200)}
     {textField("support.line2","merchantTax.street2",support?.address?.line2,200)}
     {textField("support.city","merchantTax.city",support?.address?.city,100)}
     {textField("support.state","merchantTax.region",support?.address?.state,100)}
     {textField("support.postalCode","merchantTax.postalCode",support?.address?.postalCode,40)}
     {textField("support.country","merchantTax.country",support?.address?.country,2)}
    </div></details>
   </fieldset>:null}
   <Field label={t("merchantTax.collectionStatus")} htmlFor="tax-collection-status"><Select id="tax-collection-status" name="collectionStatus" required defaultValue={config?.collectionStatus??""}>
    <option value="" disabled>{t("merchantTax.choose")}</option><option value="registered">{t("merchantTax.registered")}</option><option value="not_registered">{t("merchantTax.notRegistered")}</option>
   </Select></Field>
   <Field label={t("merchantTax.nonCollectionReason")} htmlFor="tax-non-collection-reason" hint={t("merchantTax.nonCollectionReasonHint")}><textarea id="tax-non-collection-reason" name="nonCollectionReason" rows={3} minLength={3} maxLength={1000} defaultValue={config?.nonCollectionReason??""} aria-describedby="tax-non-collection-reason-hint" className="w-full rounded-md border border-rule-strong bg-field px-3 py-2 text-base"/></Field>
   <div className="grid gap-4">
    <h2 className="font-semibold">{t("merchantTax.ratePolicies")}</h2>
    <p className="text-sm text-ink-muted">{t("merchantTax.ratePoliciesHint")}</p>
    {!zones.length?<Callout>{t("merchantTax.noZones")}</Callout>:null}
    {zones.map(zone=><section key={zone.id} className="grid min-w-0 gap-3 rounded-md border border-rule p-4">
     <h3 className="font-semibold">{zone.name}</h3>
     <p className="text-sm text-ink-muted">{t(zone.pricesIncludeTax?"merchantTax.inclusive":"merchantTax.exclusive")} · {t(zone.basis==="origin"?"merchantTax.originBasis":"merchantTax.destinationBasis")}</p>
     {zone.activationLimitation?<Callout>{zone.activationLimitation}</Callout>:null}
     {rows.map((row,index)=>row.zone.id!==zone.id?null:<fieldset key={row.rate.id} className="grid min-w-0 gap-3 rounded-md border border-rule p-3">
      <legend className="px-1 font-medium">{row.rate.name} · {new Intl.NumberFormat(locale,{style:"percent",maximumFractionDigits:4}).format(row.rate.ratePpm/1000000)}</legend>
      <input type="hidden" name={`rate.${index}.zoneId`} value={zone.id}/><input type="hidden" name={`rate.${index}.configurationDigest`} value={zone.configurationDigest}/><input type="hidden" name={`rate.${index}.rateId`} value={row.rate.id}/>
      <label className="flex items-start gap-2 text-sm"><input name={`rate.${index}.include`} type="checkbox" defaultChecked={Boolean(row.declaration)||row.rate.active} className="mt-1"/><span>{t("merchantTax.includeRate")}</span></label>
      <div className="grid gap-3 sm:grid-cols-2">
       <Field label={t("merchantTax.rateStatus")} htmlFor={`rate-${index}-status`}><Select id={`rate-${index}-status`} name={`rate.${index}.status`} defaultValue={row.declaration?.status??"monitoring"}>{["monitoring","active","paused","closed"].map(status=><option key={status} value={status}>{t(`merchantTax.status.${status}`)}</option>)}</Select></Field>
       {textField(`rate.${index}.number`,"merchantTax.registrationNumber",row.declaration?.number,200)}
       <Field label={t("merchantTax.scheme")} htmlFor={`rate-${index}-scheme`}><Select id={`rate-${index}-scheme`} name={`rate.${index}.scheme`} defaultValue={row.declaration?.scheme??"standard"}>{["standard","oss","ioss","simplified"].map(scheme=><option key={scheme} value={scheme}>{t(`merchantTax.scheme.${scheme}`)}</option>)}</Select></Field>
       {textField(`rate.${index}.collectsFrom`,"merchantTax.collectsFrom",row.declaration?.collectsFrom,10,false,"date")}
       {textField(`rate.${index}.thresholdCurrency`,"merchantTax.thresholdCurrency",row.declaration?.thresholdCurrency,3)}
       {textField(`rate.${index}.threshold`,"merchantTax.threshold",row.declaration?.thresholdCurrency?minorToDecimal(row.declaration.thresholdMinor,row.declaration.thresholdCurrency):"0",40)}
      </div>
     </fieldset>)}
    </section>)}
   </div>
   {zones.some(zone=>zone.activationLimitation)?<label className="flex items-start gap-2 text-sm"><input name="acknowledgeTemplateLimitations" type="checkbox" className="mt-1"/><span>{t("merchantTax.acknowledgeLimitations")}</span></label>:null}
   <label className="flex items-start gap-2 text-sm"><input name="acceptPolicy" type="checkbox" required className="mt-1"/><span>{t("merchantTax.acceptPolicy")}</span></label>
   {canManage?<div><Button type="submit">{t("merchantTax.save")}</Button></div>:null}
  </fieldset>
 </form>;
}
