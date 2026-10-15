// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.25: a member's bookable services and hours.
"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import { offerBookableService, setMyBookingHours } from "@/modules/members/member-services";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** The same start and end on every ticked weekday. */
function hoursFrom(form: FormData) {
  const starts = text(form, "starts") || "09:00";
  const ends = text(form, "ends") || "17:00";
  return form
    .getAll("weekday")
    .map(Number)
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    .map((weekday) => ({ weekday, starts, ends }));
}

export async function bookingAction(form: FormData): Promise<void> {
  const actor = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  try {
    if (text(form, "verb") === "offer") {
      const location = text(form, "locationType");
      await offerBookableService.call({
        productId: text(form, "productId"),
        durationMin: Number(text(form, "durationMin")) || 60,
        locationType: location === "in_person" || location === "client_site" ? location : "virtual",
        hours: hoursFrom(form),
      }, actor);
    } else {
      await setMyBookingHours.call({ hours: hoursFrom(form) }, actor);
    }
  } catch (error) {
    if (error instanceof ServiceError) redirect(`/portal/listings?error=${error.code}`);
    throw error;
  }
  redirect("/portal/listings?saved=1");
}
