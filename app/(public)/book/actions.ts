// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import { ServiceError } from "@/core/service";
import { PLAYGROUND_FICTIONAL_BOOKING_EMAIL } from "@/core/demo/playground-policy";
import { bookPublicService } from "@/modules/catalog/public-booking";
import { currentBusiness } from "@/core/settings/read";
import { localizeCustomerHref } from "@/core/i18n/customer";
import { getLocale } from "../../i18n";
export async function bookServiceAction(form: FormData) {
  const text = (key: string) => (() => { const value = form.get(key); return typeof value === "string" ? value : ""; })();
  const [business, locale] = await Promise.all([currentBusiness(), getLocale()]);
  const href = (path: string) => business ? localizeCustomerHref(path, locale, business) : path;
  let result;
  try {
    const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
    // C1.38: only the playground's reserve form sends an address; the service ignores it elsewhere.
    const guest = { ...(text("email") ? { email: text("email") } : {}), ...(text("name").trim() ? { name: text("name") } : {}) };
    result = await bookPublicService.call({ productId: text("productId"), currency: text("currency"), mode: text("mode") as "full" | "deposit_balance", seats: Number(text("seats")), calendarId: text("calendarId"), startsAt: text("startsAt"), termsHash: text("termsHash"), acceptedTerms: (form.get("acceptedTerms") === "on") as true, requestKey: text("requestKey"), ...guest }, { ...actor, request: requestMetadataFromHeaders(await headers()) });
  } catch (error) {
    const code = error instanceof ServiceError ? (error.message === PLAYGROUND_FICTIONAL_BOOKING_EMAIL ? "playgroundEmail" : error.code) : "failed";
    // A refused address keeps the chosen time chosen, so the visitor only fixes the address.
    const chosen: Record<string, string> = code === "playgroundEmail" ? { calendar: text("calendarId"), at: text("startsAt") } : {};
    const q = new URLSearchParams({ service: text("productId"), date: text("date"), mode: text("mode"), seats: text("seats"), error: code, ...chosen, ...(/^[0-9a-f-]{36}$/.test(text("seller")) ? { seller: text("seller") } : {}) });
    redirect(href(`/book?${q}`));
  }
  // A playground guest has no portal session; their appointment's own link is the confirmation.
  if (result.manageToken) redirect(href(`/portal/appointments/${encodeURIComponent(result.manageToken)}?saved=booked`));
  redirect(href(`/portal/records/bookings/${result.bookingId}?booked=1`));
}

export async function moveBookingAction(form: FormData): Promise<void> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  const [business, locale] = await Promise.all([currentBusiness(), getLocale()]);
  const href = (path: string) => business ? localizeCustomerHref(path, locale, business) : path;
  const id = (() => { const value=form.get("move"); return typeof value === "string" ? value : ""; })();
  let moved;
  try { const { moveMyBooking } = await import("@/modules/catalog/public-booking"); moved = await moveMyBooking.call({id,calendarId:(() => { const value=form.get("calendarId"); return typeof value === "string" ? value : ""; })(),startsAt:(() => { const value=form.get("startsAt"); return typeof value === "string" ? value : ""; })()},{ ...actor, request: requestMetadataFromHeaders(await headers()) }); }
  catch { redirect(href(`/book?${new URLSearchParams({move:id,error:"conflict"})}`)); }
  redirect(href(`/portal/records/bookings/${moved.id}?saved=1`));
}
