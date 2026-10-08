// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { requestMetadataFromHeaders } from "@/core/http/request-metadata";
import { ServiceError } from "@/core/service";
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
    result = await bookPublicService.call({ productId: text("productId"), currency: text("currency"), mode: text("mode") as "full" | "deposit_balance", seats: Number(text("seats")), calendarId: text("calendarId"), startsAt: text("startsAt"), termsHash: text("termsHash"), acceptedTerms: (form.get("acceptedTerms") === "on") as true, requestKey: text("requestKey") }, { ...actor, request: requestMetadataFromHeaders(await headers()) });
  } catch (error) {
    const q = new URLSearchParams({ service: text("productId"), date: text("date"), mode: text("mode"), seats: text("seats"), error: error instanceof ServiceError ? error.code : "failed" });
    redirect(href(`/book?${q}`));
  }
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
