// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { availableSlots } from "@/core/scheduling/resolver-service";
import { myProfile } from "@/core/portal/service";
import { formatMoney } from "@/core/i18n";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { currentBusiness } from "@/core/settings/read";
import { bookableServices, publicBookingQuote, myBookingSelection } from "@/modules/catalog/public-booking";
import { Button, Callout, Field, Input, Select } from "@/ui/primitives";
import { getLocale, getT } from "../../i18n";
import { bookServiceAction, moveBookingAction } from "./actions";
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> { const t=await getT(); return { title:t("publicBooking.title"), robots:{index:false,follow:true} }; }
type Query = { service?: string; date?: string; mode?: string; seats?: string; error?: string; move?: string };
export default async function PublicBooking({ searchParams }: { searchParams: Promise<Query> }) {
  const [q,t,locale,business,jar] = await Promise.all([searchParams,getT(),getLocale(),currentBusiness(),cookies()]);
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  const href = (path:string) => business ? localizeCustomerHref(path,locale,business) : path;
  const catalog = await bookableServices.call({}, actor);
  const moving = q.move && actor.kind === "user" ? await myBookingSelection.call({id:q.move},actor).catch(()=>null) : null;
  if (q.move && actor.kind === "user" && !moving) notFound();
  const selected = catalog.services.find(s=>s.productId===(moving?.productId??q.service)) ?? catalog.services[0];
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q.date ?? "") ? q.date! : new Date().toISOString().slice(0,10);
  const mode = selected?.modes.find(m=>m===q.mode) ?? selected?.modes[0] ?? "full";
  const seats = Math.min(100,Math.max(1,moving?.seats??(Math.floor(Number(q.seats))||1)));
  const profile = actor.kind === "user" ? await myProfile.call({},actor).catch(()=>null) : null;
  let quote: Awaited<ReturnType<typeof publicBookingQuote.call>> | null = null;
  let slots: Awaited<ReturnType<typeof availableSlots.call>> = [];
  let unavailable = false;
  if (selected) try {
    if (!moving) quote = await publicBookingQuote.call({productId:selected.productId,currency:catalog.currency,mode,seats},actor);
    slots = await availableSlots.call({productId:selected.productId,serviceOfferingId:selected.offeringId,from:date,to:date,seats,excludeBookingId:moving?q.move:undefined,limit:500},actor);
  } catch { unavailable=true; }
  const returnTo = `/book?${new URLSearchParams({service:selected?.productId??"",date,mode,seats:String(seats),...(q.move?{move:q.move}:{})})}`;
  const requestKey = randomUUID();
  const inZone = (d:Date) => new Intl.DateTimeFormat(locale,{timeZone:business?.timezone??"UTC",dateStyle:"medium",timeStyle:"short"}).format(d);
  return <div className="mx-auto grid max-w-3xl gap-6 px-6 py-12"><h1 className="text-3xl font-semibold">{t(moving?"portal.record.reschedule":"publicBooking.title")}</h1><p className="text-ink-muted">{t("publicBooking.intro")}</p>
    {!selected ? <Callout>{t("publicBooking.empty")}</Callout> : <>
      <form method="get" className="grid gap-4 rounded-lg border border-rule bg-surface p-6 md:grid-cols-2">
        {moving?<input type="hidden" name="move" value={q.move}/>:null}
        <Field label={t("publicBooking.service")} htmlFor="service"><Select id="service" name="service" defaultValue={selected.productId}>{catalog.services.map(s=><option key={s.productId} value={s.productId}>{s.name}</option>)}</Select></Field>
        <Field label={t("publicBooking.date")} htmlFor="date"><Input type="date" name="date" id="date" defaultValue={date} required /></Field>
        <Field label={t("publicBooking.seats")} htmlFor="seats"><Input type="number" name="seats" id="seats" min={1} max={100} defaultValue={seats} required /></Field>
        <Field label={t("publicBooking.payment")} htmlFor="mode"><Select id="mode" name="mode" defaultValue={mode}>{selected.modes.map(m=><option key={m} value={m}>{t(`publicBooking.${m}`)}</option>)}</Select></Field><Button type="submit">{t("publicBooking.find")}</Button>
      </form>
      {q.error ? <Callout tone="danger">{t(q.error==="conflict"?"publicBooking.conflict":"common.somethingWentWrong")}</Callout> : null}
      {unavailable ? <Callout>{t("publicBooking.unavailable")}</Callout> : quote || moving ? <>
        {moving ? <Callout>{t("publicBooking.moveTerms")}</Callout> : quote ? <section className="grid gap-2"><h2 className="text-xl font-semibold">{quote.name}</h2><p>{t("publicBooking.summary",{minutes:quote.durationMin,amount:formatMoney(quote.totalMinor,quote.currency,locale)})}</p><p>{t("publicBooking.due",{amount:formatMoney(quote.dueNowMinor,quote.currency,locale),balance:formatMoney(quote.balanceMinor,quote.currency,locale)})}</p><p className="text-sm text-ink-muted">{t("publicBooking.tax")}</p>{quote.policy ? <details><summary>{t("publicBooking.policy")}</summary><div className="grid gap-2 text-sm"><p>{quote.policy.name}</p><p>{t("publicBooking.freeUntil",{hours:quote.policy.freeUntilHours})}</p><p>{t(`publicBooking.fee.${quote.policy.feeType}`,{amount:formatMoney(quote.policy.feeValue??0,quote.currency,locale),percent:(quote.policy.feeValue??0)/10000})}</p><p>{t("publicBooking.rescheduleLimit",{count:quote.policy.rescheduleLimit})}</p><p>{t("publicBooking.noShow",{amount:formatMoney(quote.policy.noShowFeeMinor,quote.currency,locale)})}</p></div></details> : null}</section> : null}
        {!profile ? <Callout><a className="underline" href={href(`/portal/login?returnTo=${encodeURIComponent(returnTo)}`)}>{t("publicBooking.signIn")}</a></Callout> : <p>{t("publicBooking.as",{email:profile.email??""})}</p>}
        <section className="grid gap-4" aria-label={t("publicBooking.times")}><h2 className="text-xl font-semibold">{t("publicBooking.times")}</h2><p className="text-sm text-ink-muted">{business?.timezone??"UTC"}</p>{slots.length ? slots.map(slot=><form key={`${slot.calendarId}:${slot.startsAt.toISOString()}`} action={moving?moveBookingAction:bookServiceAction} className="grid gap-3 rounded-lg border border-rule bg-surface p-4">
          {moving?<input type="hidden" name="move" value={q.move}/>:null}
          {Object.entries({productId:selected.productId,currency:quote?.currency??catalog.currency,mode,seats:String(seats),date,calendarId:slot.calendarId,startsAt:slot.startsAt.toISOString(),termsHash:quote?.termsHash??"",requestKey}).map(([name,value])=><input key={name} type="hidden" name={name} value={value} />)}
          <p className="font-medium">{inZone(slot.startsAt)} · {slot.calendarName}</p>{profile ? <><label className="flex items-start gap-2"><input type="checkbox" name="acceptedTerms" required /><span>{t(moving?"publicBooking.acceptMove":"publicBooking.accept")}</span></label><Button type="submit">{t(moving?"portal.record.reschedule":"publicBooking.reserve")}</Button></> : null}
        </form>) : <p>{t("publicBooking.noTimes")}</p>}</section>
      </> : null}
    </>}
  </div>;
}
