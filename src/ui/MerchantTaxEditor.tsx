// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: owner/member editors aggregate only actual authorized shared queries.
import {minorToDecimal} from "@/adapters/payments/currency";
import {memberMerchantTaxExemptions,siteMerchantTaxExemptions} from "@/modules/invoicing/merchant-tax-exemptions";
import {MerchantTaxExemptionReview} from "./MerchantTaxExemptionReview";
import {myMerchantTaxThresholds,siteMerchantTaxThresholds} from "@/modules/invoicing/merchant-tax-thresholds";
import type {Actor} from "@/core/service";
import {ServiceError} from "@/core/service";
import type {Translate} from "@/core/i18n";
import {myMerchantTaxProfile,siteMerchantTaxProfile,listMerchantTaxZones,siteMerchantTaxZones,merchantTaxZoneConfiguration,siteMerchantTaxZoneConfiguration} from "@/modules/invoicing/merchant-tax-profiles";
import {Button,Callout,Card,CardBody,CardHeader,Field,Input,Select} from "@/ui/primitives";
import {MerchantTaxForm,type MerchantTaxFormZone} from "./MerchantTaxForm";
export type MerchantTaxEditorQuery={country?:string;q?:string;zone?:string|string[];addZone?:string;exclude?:string|string[];offset?:string;error?:string;saved?:string;window?:string;reviewed?:string;reviewError?:string;exemptionStatus?:string;exemptionOffset?:string};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export async function loadMerchantTaxEditor(actor:Actor,site:boolean,query:MerchantTaxEditorQuery){
 const window=query.window==="rolling_12_months"?"rolling_12_months":"calendar_year";
 const[profile,thresholds]=await Promise.all([site?siteMerchantTaxProfile.call({},actor):myMerchantTaxProfile.call({},actor),site?siteMerchantTaxThresholds.call({window},actor):myMerchantTaxThresholds.call({window},actor)]);
 const exemptionStatus=query.exemptionStatus==="valid"?"valid":query.exemptionStatus==="expired"?"expired":query.exemptionStatus==="revoked"?"revoked":"pending";
 const requestedExemptionOffset=Number(query.exemptionOffset??0),exemptionOffset=Number.isInteger(requestedExemptionOffset)&&requestedExemptionOffset>=0&&requestedExemptionOffset<=100000?requestedExemptionOffset:0;
 const exemptionInput={status:exemptionStatus,offset:exemptionOffset,limit:20};
 const exemptions=profile?.state==="active"?(site?await siteMerchantTaxExemptions.call(exemptionInput,actor):await memberMerchantTaxExemptions.call(exemptionInput,actor)):{rows:[],nextOffset:null};
 const string=(value:unknown)=>typeof value==="string"?value:"";
 const country=string(query.country).trim().toUpperCase();
 const offset=Number(query.offset??0);
 const search={...(country&&/^[A-Z]{2}$/.test(country)?{country}:{}),...(string(query.q)?{q:string(query.q).trim().slice(0,100)}:{}),offset:Number.isInteger(offset)&&offset>=0&&offset<=100000?offset:0,limit:100};
 const available=site?await siteMerchantTaxZones.call(search,actor):await listMerchantTaxZones.call(search,actor);
 const excluded=new Set((Array.isArray(query.exclude)?query.exclude:query.exclude?[query.exclude]:[]).filter(id=>typeof id==="string"&&uuid.test(id)).slice(0,100));
 const requested=(Array.isArray(query.zone)?query.zone:query.zone?[query.zone]:[]).filter(id=>typeof id==="string"&&uuid.test(id));
 if(typeof query.addZone==="string"&&uuid.test(query.addZone)){requested.push(query.addZone);excluded.delete(query.addZone);}
 const selected=[...new Set([...(profile?.configuration?.rulesSnapshot.map(rule=>rule.zone.id)??[]),...requested])].filter(id=>!excluded.has(id));
 if(selected.length>100)throw new ServiceError("validation","Choose at most 100 business tax jurisdictions.");
 const zones:MerchantTaxFormZone[]=[],missing:Array<{id:string;name:string|null}>=[];
 for(const zoneId of selected){
  try{zones.push(site?await siteMerchantTaxZoneConfiguration.call({zoneId},actor):await merchantTaxZoneConfiguration.call({zoneId},actor));}
  catch(error){if(!(error instanceof ServiceError)||!["conflict","not_found"].includes(error.code))throw error;missing.push({id:zoneId,name:profile?.configuration?.rulesSnapshot.find(rule=>rule.zone.id===zoneId)?.zone.name??null});}
 }
 return{profile,thresholds,exemptions,exemptionStatus,exemptionOffset,available,zones,missing,excluded:[...excluded],requested:requested.filter(id=>!excluded.has(id)),search};
}
export function MerchantTaxEditor({data,query,path,site,action,reviewAction,t,locale,canManage=true}:{data:Awaited<ReturnType<typeof loadMerchantTaxEditor>>;query:MerchantTaxEditorQuery;path:string;site:boolean;action:(form:FormData)=>Promise<void>;reviewAction:(form:FormData)=>Promise<void>;t:Translate;locale:string;canManage?:boolean}){
 const href=(options:{exclude?:string;offset?:number;exemptionOffset?:number})=>{const parameters=new URLSearchParams();parameters.set("window",data.thresholds.window);parameters.set("exemptionStatus",data.exemptionStatus);parameters.set("exemptionOffset",String(options.exemptionOffset??data.exemptionOffset));if(data.search.country)parameters.set("country",data.search.country);if(data.search.q)parameters.set("q",data.search.q);for(const id of data.requested)if(id!==options.exclude)parameters.append("zone",id);for(const id of new Set([...data.excluded,...(options.exclude?[options.exclude]:[])]))parameters.append("exclude",id);if(options.offset!==undefined)parameters.set("offset",String(options.offset));return`${path}?${parameters.toString()}`;};
 const error=query.error?["validation","conflict","permission","not_found","rate_limited"].includes(query.error)?query.error:"failed":null;
 return <div className="grid gap-6">
  {error?<Callout tone="danger">{t(`merchantTax.error.${error}`)}</Callout>:null}
  {query.reviewError?<Callout tone="danger">{t("merchantTax.exemption.reviewError")}</Callout>:null}
  {query.reviewed?<Callout tone="success">{t("merchantTax.exemption.reviewed")}</Callout>:null}
  {query.saved?<Callout tone="success">{t("merchantTax.saved")}</Callout>:null}
  <Card><CardHeader title={t("merchantTax.chooseJurisdictions")}/><CardBody>
   <p className="mb-4 text-sm text-ink-muted">{t("merchantTax.chooseJurisdictionsHint")}</p>
   <form action={path} className="grid gap-3 sm:grid-cols-2">
    <input type="hidden" name="window" value={data.thresholds.window}/>
    {data.excluded.map(id=><input key={id} type="hidden" name="exclude" value={id}/>)}
    {data.requested.map(id=><input key={id} type="hidden" name="zone" value={id}/>)}
    <Field label={t("merchantTax.country")} htmlFor="tax-zone-country"><Input id="tax-zone-country" name="country" maxLength={2} pattern="[A-Za-z]{2}" defaultValue={data.search.country??""}/></Field>
    <Field label={t("merchantTax.searchJurisdictions")} htmlFor="tax-zone-search"><Input id="tax-zone-search" name="q" maxLength={100} defaultValue={data.search.q??""}/></Field>
    <div><Button type="submit" variant="quiet">{t("merchantTax.search")}</Button></div>
   </form>
   <form action={path} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
    <input type="hidden" name="window" value={data.thresholds.window}/>
    {data.excluded.map(id=><input key={id} type="hidden" name="exclude" value={id}/>)}
    {data.requested.map(id=><input key={id} type="hidden" name="zone" value={id}/>)}
    <input type="hidden" name="country" value={data.search.country??""}/><input type="hidden" name="q" value={data.search.q??""}/>
    <Field label={t("merchantTax.jurisdiction")} htmlFor="tax-zone-add"><Select id="tax-zone-add" name="addZone" required defaultValue=""><option value="" disabled>{t("merchantTax.choose")}</option>{data.available.rows.map(zone=><option key={zone.id} value={zone.id}>{zone.country} · {zone.name}</option>)}</Select></Field>
    <div className="self-end"><Button type="submit" variant="quiet">{t("merchantTax.addJurisdiction")}</Button></div>
   </form>
   {data.available.nextOffset!==null?<a className="mt-3 inline-block text-sm underline" href={href({offset:data.available.nextOffset})}>{t("merchantTax.moreJurisdictions")}</a>:null}
   <ul className="mt-4 grid list-none gap-2 p-0">{[...data.zones,...data.missing].map(zone=><li key={zone.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{zone.name??t("merchantTax.unknownJurisdiction")}</span><a href={href({exclude:zone.id})} className="underline">{t("merchantTax.removeJurisdiction")}</a></li>)}</ul>
  </CardBody></Card>
  {data.missing.length?<Callout tone="danger">{t("merchantTax.jurisdictionChanged")}</Callout>:null}
  <Card><CardHeader title={t("merchantTax.declaration")}/><CardBody><MerchantTaxForm profile={data.profile} zones={data.zones} site={site} action={action} t={t} locale={locale} canManage={canManage&&!data.missing.length}/></CardBody></Card>
  <Card><CardHeader title={t("tax.thresholds")}/><CardBody>
   <p className="mb-4 text-sm text-ink-muted">{t("merchantTax.thresholdHint")}</p>
   <form action={path} className="mb-4 flex flex-wrap items-end gap-3">
    {data.excluded.map(id=><input key={id} type="hidden" name="exclude" value={id}/>)}{data.requested.map(id=><input key={id} type="hidden" name="zone" value={id}/>)}
    <input type="hidden" name="country" value={data.search.country??""}/><input type="hidden" name="q" value={data.search.q??""}/>
    <Field label={t("merchantTax.reportWindow")} htmlFor="merchant-tax-window"><Select id="merchant-tax-window" name="window" defaultValue={data.thresholds.window}><option value="calendar_year">{t("merchantTax.window.calendar_year")}</option><option value="rolling_12_months">{t("merchantTax.window.rolling_12_months")}</option></Select></Field>
    <Button type="submit" variant="quiet">{t("merchantTax.showTotals")}</Button>
   </form>
   {data.thresholds.thresholds.some(row=>["approaching","reached"].includes(row.state))?<Callout tone="warning">{t("merchantTax.thresholdAttention")}</Callout>:null}
   {data.thresholds.thresholds.length?<ul className="grid list-none gap-4 p-0">{data.thresholds.thresholds.map(row=><li key={row.registration.id} className="min-w-0 text-sm">
    <p className="font-medium">{row.zone.name} · {row.rates.join(", ")}</p><p>{t(`tax.thresholds.state.${row.state}`)}</p>
    {row.registration.thresholdCurrency?<p>{t("merchantTax.grossSales")}: <bdi>{row.registration.thresholdCurrency} {minorToDecimal(row.grossSalesMinor,row.registration.thresholdCurrency)}</bdi> · {t("merchantTax.threshold")}: <bdi>{row.registration.thresholdCurrency} {minorToDecimal(row.registration.thresholdMinor,row.registration.thresholdCurrency)}</bdi></p>:null}
    <ul className="mt-1 list-none p-0 text-ink-muted">{row.totalsByCurrency.filter(value=>value.currency!==row.registration.thresholdCurrency).map(value=><li key={value.currency}>{t("merchantTax.grossSales")}: <bdi>{value.currency} {minorToDecimal(value.grossSalesMinor,value.currency)}</bdi></li>)}</ul>
   </li>)}</ul>:<p className="text-sm text-ink-muted">{t("tax.thresholds.empty")}</p>}
  </CardBody></Card>
  <Card><CardHeader title={t("tax.exemptions")}/><CardBody>
   <p className="mb-4 text-sm text-ink-muted">{t("merchantTax.exemption.reviewHint")}</p>
   <form action={path} className="mb-4 flex flex-wrap items-end gap-3">
    <input type="hidden" name="window" value={data.thresholds.window}/>{data.excluded.map(id=><input key={id} type="hidden" name="exclude" value={id}/>)}{data.requested.map(id=><input key={id} type="hidden" name="zone" value={id}/>)}
    <input type="hidden" name="country" value={data.search.country??""}/><input type="hidden" name="q" value={data.search.q??""}/>
    <Field label={t("tax.exemption.status")} htmlFor="merchant-exemption-status"><Select id="merchant-exemption-status" name="exemptionStatus" defaultValue={data.exemptionStatus}>{["pending","valid","expired","revoked"].map(status=><option key={status} value={status}>{t(`tax.exemption.status.${status}`)}</option>)}</Select></Field>
    <Button type="submit" variant="quiet">{t("merchantTax.search")}</Button>
   </form>
   <MerchantTaxExemptionReview rows={data.exemptions.rows} action={reviewAction} canManage={canManage} t={t}/>
   {data.exemptions.nextOffset!==null?<a className="mt-4 inline-block text-sm underline" href={href({exemptionOffset:data.exemptions.nextOffset})}>{t("merchantTax.exemption.more")}</a>:null}
  </CardBody></Card>
 </div>;
}
