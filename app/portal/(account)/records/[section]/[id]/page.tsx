// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { cookies } from "next/headers";
import { notFound,redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { myRecord } from "@/core/portal/record-service";
import { ServiceError } from "@/core/service";
import { formatMoney } from "@/core/i18n";
import { currentBusiness } from "@/core/settings/read";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { Button,Callout,Field,Input } from "@/ui/primitives";
import { getLocale,getT } from "../../../../../i18n";
import { portalRecordAction } from "./actions";
export const dynamic="force-dynamic";
export default async function CustomerRecord({params,searchParams}:{params:Promise<{section:string;id:string}>;searchParams:Promise<{error?:string;saved?:string;booked?:string}>}){
  const [asked,q,t,locale,business,jar]=await Promise.all([params,searchParams,getT(),getLocale(),currentBusiness(),cookies()]);
  const href=(p:string)=>business?localizeCustomerHref(p,locale,business):p;
  const actor=await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  if(actor.kind!=="user")redirect(href(`/portal/login?returnTo=${encodeURIComponent(`/portal/records/${asked.section}/${asked.id}`)}`));
  let record;
  try{record=await myRecord.call(asked,actor);}catch(e){if(e instanceof ServiceError&&["not_found","validation"].includes(e.code))notFound();throw e;}
  return <div className="grid gap-6"><a className="underline" href={href(`/portal/${asked.section}`)}>{t("portal.record.back")}</a><h1 className="text-2xl font-semibold">{record.title}</h1>{q.booked?<Callout tone="success">{t("publicBooking.booked")}</Callout>:null}{q.saved?<Callout tone="success">{t("common.saved")}</Callout>:null}{q.error?<Callout tone="danger">{t("common.somethingWentWrong")}</Callout>:null}<p>{record.status}</p>{record.at?<time dateTime={record.at.toISOString()}>{new Intl.DateTimeFormat(locale,{dateStyle:"full",timeStyle:"short",timeZone:business?.timezone??"UTC"}).format(record.at)}</time>:null}{record.amountMinor!==null&&record.currency?<p className="text-xl">{formatMoney(record.amountMinor,record.currency,locale)}</p>:null}<dl className="grid gap-4">{record.fields.map((f,i)=><div key={i}><dt className="font-medium">{t(f.labelKey)}</dt><dd className="whitespace-pre-wrap text-ink-muted">{f.value}</dd></div>)}</dl><ul className="grid list-none gap-3 p-0">{record.lines.map((line,i)=><li key={i} className="flex justify-between gap-4 border-b border-rule pb-3"><span className="whitespace-pre-wrap">{line.description}</span>{line.amountMinor!==undefined&&line.currency?<span>{formatMoney(line.amountMinor,line.currency,locale)}</span>:null}</li>)}</ul>{record.links.map(link=><a className="underline" key={link.href} href={href(link.href)}>{t(link.labelKey)}</a>)}{record.actions.map(action=><form key={action} action={portalRecordAction} className="grid gap-3 rounded-lg border border-rule p-4"><input type="hidden" name="section" value={asked.section}/><input type="hidden" name="id" value={asked.id}/><input type="hidden" name="action" value={action}/>{action==="accept"?<Field label={t("portal.record.signature")} htmlFor="accepted-name"><Input id="accepted-name" name="name" autoComplete="name" minLength={2} required/></Field>:null}{action==="cancel"||action==="decline"?<Field label={t("portal.record.reason")} htmlFor={`${action}-reason`}><Input id={`${action}-reason`} name="reason" maxLength={500}/></Field>:null}<label className="flex items-start gap-2"><input type="checkbox" required/><span>{t(`portal.record.confirm.${action}`)}</span></label><Button type="submit">{t(`portal.record.${action}`)}</Button></form>)}</div>;
}
