// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { env } from "@/core/env";
import { actorFromToken } from "@/core/http/actor";
import { availableSlots } from "@/core/scheduling/resolver-service";
import { myProfile } from "@/core/portal/service";
import { formatMoney, zoneLabel } from "@/core/i18n";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { currentBusiness } from "@/core/settings/read";
import { utilityPageMetadata } from "../utility-metadata";
import { bookableServices, publicBookingQuote, myBookingSelection } from "@/modules/catalog/public-booking";
import { Button, Callout, Field, Input, Select, cx } from "@/ui/primitives";
import { getLocale, getT } from "../../i18n";
import { bookServiceAction, moveBookingAction } from "./actions";
import { chosenSlot } from "./chosen";
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return utilityPageMetadata({ path: "book", title: t("publicBooking.title"), description: t("publicBooking.intro"), index: false });
}
type Query = { service?: string; date?: string; mode?: string; seats?: string; error?: string; move?: string; seller?: string; calendar?: string; at?: string };
const ERRORS: Record<string, string> = { conflict: "publicBooking.conflict", playgroundEmail: "publicBooking.error.playgroundEmail" };
export default async function PublicBooking({ searchParams }: { searchParams: Promise<Query> }) {
  const [q,t,locale,business,jar] = await Promise.all([searchParams,getT(),getLocale(),currentBusiness(),cookies()]);
  const actor = await actorFromToken(jar.get(SESSION_COOKIE)?.value);
  const href = (path:string) => business ? localizeCustomerHref(path,locale,business) : path;
  // C12.25: a member's services are booked here with ?seller=<their user id>.
  const seller = /^[0-9a-f-]{36}$/.test(q.seller ?? "") ? q.seller : undefined;
  const catalog = await bookableServices.call({ sellerUserId: seller }, actor);
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
  const search = (extra: Record<string,string> = {}) => new URLSearchParams({service:selected?.productId??"",date,mode,seats:String(seats),...(q.move?{move:q.move}:{}),...(seller?{seller}:{}),...extra});
  // A time is chosen before anybody is asked to prove an email (C6.19): the
  // choice rides through sign-in in the return address and comes back chosen.
  const chosen = chosenSlot(slots, q.calendar, q.at);
  const choice = chosen ? {calendar:chosen.calendarId,at:chosen.startsAt.toISOString()} : undefined;
  const returnTo = `/book?${search(choice)}`;
  const requestKey = randomUUID();
  const zone = business?.timezone ?? "UTC";
  const verified = Boolean(profile || moving);
  // C1.38: the public demo sends no mail, so it reserves for a made-up address instead.
  const playground = env().FREEHOLDER_PLAYGROUND === "1" && !verified;
  // One calendar is the common case; naming it beside every time only repeats it.
  // A member's services (C12.25) always name whose time it is: the visitor
  // chose a person from a profile, not a business.
  const manyCalendars = Boolean(seller) || new Set(slots.map(s=>s.calendarId)).size > 1;
  const time = (d:Date) => new Intl.DateTimeFormat(locale,{timeZone:zone,timeStyle:"short"}).format(d);
  const day = (d:Date) => new Intl.DateTimeFormat(locale,{timeZone:zone,dateStyle:"full"}).format(d);
  const label = (slot: (typeof slots)[number]) => manyCalendars ? `${time(slot.startsAt)} · ${slot.calendarName}` : time(slot.startsAt);
  const hidden = (slot: (typeof slots)[number]) => Object.entries({productId:selected?.productId??"",currency:quote?.currency??catalog.currency,mode,seats:String(seats),date,calendarId:slot.calendarId,startsAt:slot.startsAt.toISOString(),termsHash:quote?.termsHash??"",requestKey,seller:seller??""}).map(([name,value])=><input key={name} type="hidden" name={name} value={value} />);
  const ordered = chosen ? [chosen,...slots.filter(s=>s!==chosen)] : slots;
  return <div className="mx-auto grid max-w-3xl gap-6 px-6 py-12"><h1 className="text-3xl font-semibold">{t(moving?"portal.record.reschedule":"publicBooking.title")}</h1><p className="text-ink-muted">{t("publicBooking.intro")}</p>
    {!selected ? <Callout>{t("publicBooking.empty")}</Callout> : <>
      <form method="get" className="grid gap-4 rounded-lg border border-rule bg-surface p-6 md:grid-cols-2">
        {moving?<input type="hidden" name="move" value={q.move}/>:null}
        {seller?<input type="hidden" name="seller" value={seller}/>:null}
        <Field label={t("publicBooking.service")} htmlFor="service"><Select id="service" name="service" defaultValue={selected.productId}>{catalog.services.map(s=><option key={s.productId} value={s.productId}>{s.name}</option>)}</Select></Field>
        <Field label={t("publicBooking.date")} htmlFor="date"><Input type="date" name="date" id="date" defaultValue={date} required /></Field>
        <Field label={t("publicBooking.seats")} htmlFor="seats"><Input type="number" name="seats" id="seats" min={1} max={100} defaultValue={seats} required /></Field>
        <Field label={t("publicBooking.payment")} htmlFor="mode"><Select id="mode" name="mode" defaultValue={mode}>{selected.modes.map(m=><option key={m} value={m}>{t(`publicBooking.${m}`)}</option>)}</Select></Field><Button type="submit">{t("publicBooking.find")}</Button>
      </form>
      {q.error ? <Callout tone="danger">{t(ERRORS[q.error] ?? "common.somethingWentWrong")}</Callout> : null}
      {unavailable ? <Callout>{t("publicBooking.unavailable")}</Callout> : quote || moving ? <>
        {moving ? <Callout>{t("publicBooking.moveTerms")}</Callout> : quote ? <section className="grid gap-2"><h2 className="text-xl font-semibold">{quote.name}</h2><p>{t("publicBooking.summary",{minutes:quote.durationMin,amount:formatMoney(quote.totalMinor,quote.currency,locale)})}</p><p>{t("publicBooking.due",{amount:formatMoney(quote.dueNowMinor,quote.currency,locale),balance:formatMoney(quote.balanceMinor,quote.currency,locale)})}</p><p className="text-sm text-ink-muted">{t("publicBooking.tax")}</p>{quote.policy ? <details><summary>{t("publicBooking.policy")}</summary><div className="grid gap-2 text-sm"><p>{quote.policy.name}</p><p>{t("publicBooking.freeUntil",{hours:quote.policy.freeUntilHours})}</p><p>{t(`publicBooking.fee.${quote.policy.feeType}`,{amount:formatMoney(quote.policy.feeValue??0,quote.currency,locale),percent:(quote.policy.feeValue??0)/10000})}</p><p>{t("publicBooking.rescheduleLimit",{count:quote.policy.rescheduleLimit})}</p><p>{t("publicBooking.noShow",{amount:formatMoney(quote.policy.noShowFeeMinor,quote.currency,locale)})}</p></div></details> : null}</section> : null}
        {profile ? <p>{t("publicBooking.as",{email:profile.email??""})}</p> : !moving && !chosen && slots.length ? <Callout>{t(playground?"publicBooking.pickFirstPlayground":"publicBooking.pickFirst")}</Callout> : null}
        {!verified && chosen ? <section id="reserve" className="grid gap-3 rounded-lg border border-accent bg-surface p-4" aria-labelledby="reserve-heading">
          <h2 id="reserve-heading" className="text-xl font-semibold">{t("publicBooking.chosen")}</h2>
          <p className="font-medium">{day(chosen.startsAt)} · {label(chosen)}</p>
          <p className="text-sm text-ink-muted">{zoneLabel(zone,locale,chosen.startsAt)}</p>
          {playground ? <form action={bookServiceAction} className="grid gap-3">
            {hidden(chosen)}
            <Field label={t("publicBooking.name")} htmlFor="booking-name"><Input id="booking-name" name="name" autoComplete="name" maxLength={200} /></Field>
            <Field label={t("publicBooking.email")} htmlFor="booking-email"><Input id="booking-email" type="email" name="email" autoComplete="email" required /></Field>
            <span className="text-xs text-ink-muted">{t("publicBooking.playgroundEmailHint")}</span>
            <label className="flex items-start gap-2"><input type="checkbox" name="acceptedTerms" required /><span>{t("publicBooking.accept")}</span></label>
            <Button type="submit">{t("publicBooking.reserve")}</Button>
          </form> : <p><a className="font-semibold text-accent underline" href={href(`/portal/login?returnTo=${encodeURIComponent(returnTo)}`)}>{t("publicBooking.signInChosen")}</a></p>}
        </section> : null}
        <section className="grid gap-4" aria-label={t("publicBooking.times")}><h2 className="text-xl font-semibold">{t("publicBooking.times")}</h2>{slots.length ? <p className="text-sm text-ink-muted">{t("publicBooking.zone",{day:day(slots[0]!.startsAt),zone:zoneLabel(zone,locale,slots[0]!.startsAt)})}</p> : null}
        {!slots.length ? <p>{t("publicBooking.noTimes")}</p> : verified ? ordered.map(slot=><form key={`${slot.calendarId}:${slot.startsAt.toISOString()}`} action={moving?moveBookingAction:bookServiceAction} className={cx("grid gap-3 rounded-lg border bg-surface p-4", slot===chosen ? "border-accent" : "border-rule")}>
          {moving?<input type="hidden" name="move" value={q.move}/>:null}
          {hidden(slot)}
          <p className="font-medium">{label(slot)}</p><label className="flex items-start gap-2"><input type="checkbox" name="acceptedTerms" required /><span>{t(moving?"publicBooking.acceptMove":"publicBooking.accept")}</span></label><Button type="submit">{t(moving?"portal.record.reschedule":"publicBooking.reserve")}</Button>
        </form>) : <ul className="flex list-none flex-wrap gap-2 p-0">{slots.map(slot=>{
          const current = slot===chosen;
          return <li key={`${slot.calendarId}:${slot.startsAt.toISOString()}`}><a href={href(`/book?${search({calendar:slot.calendarId,at:slot.startsAt.toISOString()})}#reserve`)} aria-current={current ? "true" : undefined} aria-label={t("publicBooking.choose",{time:label(slot)})} className={cx("inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold", current ? "bg-accent text-on-accent shadow-press" : "border border-rule text-ink hover:border-accent")}>{label(slot)}</a></li>;
        })}</ul>}</section>
      </> : null}
    </>}
  </div>;
}
