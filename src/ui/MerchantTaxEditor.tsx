// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: owner/member editors aggregate only actual authorized shared queries.
import type {Actor} from "@/core/service";
import {ServiceError} from "@/core/service";
import type {Translate} from "@/core/i18n";
import {myMerchantTaxProfile,siteMerchantTaxProfile,listMerchantTaxZones,siteMerchantTaxZones,merchantTaxZoneConfiguration,siteMerchantTaxZoneConfiguration} from "@/modules/invoicing/merchant-tax-profiles";
import {Button,Callout,Card,CardBody,CardHeader,Field,Input,Select} from "@/ui/primitives";
import {MerchantTaxForm,type MerchantTaxFormZone} from "./MerchantTaxForm";
export type MerchantTaxEditorQuery={country?:string;q?:string;zone?:string|string[];addZone?:string;exclude?:string|string[];offset?:string;error?:string;saved?:string};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export async function loadMerchantTaxEditor(actor:Actor,site:boolean,query:MerchantTaxEditorQuery){
 const profile=site?await siteMerchantTaxProfile.call({},actor):await myMerchantTaxProfile.call({},actor);
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
 return{profile,available,zones,missing,excluded:[...excluded],requested:requested.filter(id=>!excluded.has(id)),search};
}
export function MerchantTaxEditor({data,query,path,site,action,t,locale,canManage=true}:{data:Awaited<ReturnType<typeof loadMerchantTaxEditor>>;query:MerchantTaxEditorQuery;path:string;site:boolean;action:(form:FormData)=>Promise<void>;t:Translate;locale:string;canManage?:boolean}){
 const href=(options:{exclude?:string;offset?:number})=>{const parameters=new URLSearchParams();if(data.search.country)parameters.set("country",data.search.country);if(data.search.q)parameters.set("q",data.search.q);for(const id of data.requested)if(id!==options.exclude)parameters.append("zone",id);for(const id of new Set([...data.excluded,...(options.exclude?[options.exclude]:[])]))parameters.append("exclude",id);if(options.offset!==undefined)parameters.set("offset",String(options.offset));return`${path}?${parameters.toString()}`;};
 const error=query.error?["validation","conflict","permission","not_found","rate_limited"].includes(query.error)?query.error:"failed":null;
 return <div className="grid gap-6">
  {error?<Callout tone="danger">{t(`merchantTax.error.${error}`)}</Callout>:null}
  {query.saved?<Callout tone="success">{t("merchantTax.saved")}</Callout>:null}
  <Card><CardHeader title={t("merchantTax.chooseJurisdictions")}/><CardBody>
   <p className="mb-4 text-sm text-ink-muted">{t("merchantTax.chooseJurisdictionsHint")}</p>
   <form action={path} className="grid gap-3 sm:grid-cols-2">
    {data.excluded.map(id=><input key={id} type="hidden" name="exclude" value={id}/>)}
    {data.requested.map(id=><input key={id} type="hidden" name="zone" value={id}/>)}
    <Field label={t("merchantTax.country")} htmlFor="tax-zone-country"><Input id="tax-zone-country" name="country" maxLength={2} pattern="[A-Za-z]{2}" defaultValue={data.search.country??""}/></Field>
    <Field label={t("merchantTax.searchJurisdictions")} htmlFor="tax-zone-search"><Input id="tax-zone-search" name="q" maxLength={100} defaultValue={data.search.q??""}/></Field>
    <div><Button type="submit" variant="quiet">{t("merchantTax.search")}</Button></div>
   </form>
   <form action={path} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
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
 </div>;
}
