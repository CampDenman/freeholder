// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import {cookies} from "next/headers";
import {notFound,redirect} from "next/navigation";
import {SESSION_COOKIE} from "@/core/auth/sessions";
import {actorFromToken} from "@/core/http/actor";
import {ServiceError} from "@/core/service";
import {formatMoney} from "@/core/i18n";
import {currentBusiness} from "@/core/settings/read";
import {localizeCustomerHref} from "@/core/i18n/customer";
import {myOrderReturns} from "@/modules/catalog/customer-returns";
import {Button,Callout,Field,Input} from "@/ui/primitives";
import {getLocale,getT} from "../../../../../i18n";
import {customerReturnAction} from "./actions";
export const dynamic="force-dynamic";
export default async function CustomerReturns({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{saved?:string;error?:string}>}){
 const [{id},q,t,locale,business,jar]=await Promise.all([params,searchParams,getT(),getLocale(),currentBusiness(),cookies()]);
 const href=(p:string)=>business?localizeCustomerHref(p,locale,business):p;
 const actor=await actorFromToken(jar.get(SESSION_COOKIE)?.value);
 if(actor.kind!=="user")redirect(href(`/portal/login?returnTo=${encodeURIComponent(`/portal/orders/${id}/returns`)}`));
 let data;try{data=await myOrderReturns.call({orderId:id},actor);}catch(error){if(error instanceof ServiceError&&["not_found","validation"].includes(error.code))notFound();throw error;}
 return <div className="grid gap-6"><a className="underline" href={href(`/portal/records/orders/${id}`)}>{t("portal.record.back")}</a><h1 className="text-2xl font-semibold">{t("catalog.customerReturns.title")}</h1><p>{t("catalog.customerReturns.intro")}</p>{q.saved?<Callout tone="success">{t("catalog.customerReturns.requested")}</Callout>:null}{q.error?<Callout tone="danger">{t("common.somethingWentWrong")}</Callout>:null}
 {data.canRequest&&data.items.some(item=>item.available>0)?<form action={customerReturnAction} className="grid gap-4 rounded-lg border border-rule p-4"><input type="hidden" name="orderId" value={id}/><h2 className="text-lg font-semibold">{t("catalog.customerReturns.request")}</h2>{data.items.filter(item=>item.available>0).map(item=><Field key={item.id} htmlFor={`quantity-${item.id}`} label={t("catalog.customerReturns.quantity",{name:item.description,count:item.available})}><Input id={`quantity-${item.id}`} name={`quantity:${item.id}`} type="number" min={0} max={item.available} step={1} defaultValue={0}/></Field>)}<Field htmlFor="return-reason" label={t("portal.record.reason")}><textarea className="w-full rounded-md border border-rule bg-surface p-3 text-ink" id="return-reason" name="reason" minLength={3} maxLength={1000} required/></Field><Button type="submit">{t("catalog.customerReturns.request")}</Button></form>:null}
 <h2 className="text-lg font-semibold">{t("catalog.customerReturns.progress")}</h2>{!data.returns.length?<p>{t("catalog.customerReturns.empty")}</p>:data.returns.map(request=><section key={request.id} className="grid gap-3 rounded-lg border border-rule p-4"><h3 className="font-semibold">{t(`catalog.returns.status.${request.status}`)}</h3><p className="whitespace-pre-wrap">{request.reason}</p><ul>{request.items.map(item=><li key={item.orderItemId}>{item.quantity} · {data.items.find(line=>line.id===item.orderItemId)?.description??item.orderItemId.slice(0,8)}</li>)}</ul>{request.labelUrl?<a className="underline" href={request.labelUrl} rel="noreferrer">{t("catalog.customerReturns.label")}</a>:null}{request.refund.amountMinor>0?<p>{t("catalog.customerReturns.refund",{confirmed:formatMoney(request.refund.confirmedMinor,request.refund.currency,locale),total:formatMoney(request.refund.amountMinor,request.refund.currency,locale)})}</p>:null}</section>)}</div>;
}
