// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for the appointments workspace (C6.07). The lifecycle rules,
// the contact resolution and the overlap refusal all live in the services.

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  addBookingParticipant,
  createBooking,
  removeBookingParticipant,
  rescheduleBooking,
  setBookingStatus,
  setParticipantStatus,
} from "@/core/scheduling/bookings";
import {
  offerWaitlistSlot,
  setWaitlistPosition,
  withdrawFromWaitlist,
} from "@/core/scheduling/waitlist";
import { issueBookingWaiver } from "@/core/scheduling/requirements";
import {
  addBookingReminder,
  cancelBookingReminder,
} from "@/core/scheduling/reminders";
import { zonedInstant } from "@/core/i18n/zoned";
import { ownerFacing } from "./action-helpers";

const APPOINTMENTS = "/admin/appointments";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/**
 * The refusal is the message, not a code.
 *
 * "That time was taken while you were booking it" is the whole value of the
 * exclusion constraint reaching a person; a generic failure would waste it.
 */
function refused(error: unknown, path: string, fallback: string): never {
  const message = error instanceof ServiceError ? ownerFacing(error.message) : fallback;
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

/** A local wall-clock reading from the form, as an instant in the given zone. */
function instant(local: string, timezone: string): string {
  const [datePart, timePart] = local.split("T");
  const [year, month, day] = (datePart ?? "").split("-").map(Number);
  const [hour, minute] = (timePart ?? "").split(":").map(Number);
  if (!year || !month || !day) throw new ServiceError("validation", "Choose a time.");
  return zonedInstant(timezone, {
    year,
    month,
    day,
    hour: hour ?? 0,
    minute: minute ?? 0,
  }).toISOString();
}

export async function createBookingAction(form: FormData): Promise<void> {
  const timezone = text(form, "timezone") || "UTC";
  const minutes = Number(text(form, "durationMin")) || 60;
  try {
    const startsAt = instant(text(form, "startsAt"), timezone);
    await createBooking.call(
      {
        calendarId: text(form, "calendarId"),
        contact: {
          email: text(form, "email"),
          name: text(form, "name") || undefined,
          phone: text(form, "phone") || undefined,
        },
        startsAt,
        endsAt: new Date(new Date(startsAt).getTime() + minutes * 60_000).toISOString(),
        notes: text(form, "notes") || undefined,
        status: text(form, "status") === "confirmed" ? "confirmed" : "requested",
        source: "admin",
      },
      await actor(),
    );
  } catch (error) {
    refused(error, APPOINTMENTS, "That appointment could not be made.");
  }
  revalidatePath(APPOINTMENTS);
  redirect(`${APPOINTMENTS}?saved=created`);
}

export async function setBookingStatusAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  const status = text(form, "status");
  try {
    await setBookingStatus.call(
      {
        id,
        status: status as "confirmed" | "in_progress" | "completed" | "no_show" | "cancelled",
        reason: text(form, "reason") || undefined,
        // The owner's own override: somebody who signed on paper in the shop
        // has met the requirement in the way that matters.
        overrideRequirements: text(form, "overrideRequirements") === "on",
      },
      await actor(),
    );
  } catch (error) {
    refused(error, `${APPOINTMENTS}/${id}`, "That could not be changed.");
  }
  revalidatePath(`${APPOINTMENTS}/${id}`);
  redirect(`${APPOINTMENTS}/${id}`);
}

export async function rescheduleBookingAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  const timezone = text(form, "timezone") || "UTC";
  const minutes = Number(text(form, "durationMin")) || 60;
  let movedId: string;
  try {
    const startsAt = instant(text(form, "startsAt"), timezone);
    const moved = await rescheduleBooking.call(
      {
        id,
        startsAt,
        endsAt: new Date(new Date(startsAt).getTime() + minutes * 60_000).toISOString(),
        reason: text(form, "reason") || undefined,
        // The policy binds the customer, not the business. An owner who agrees
        // to move somebody as a favour should not have to cancel and rebook.
        overridePolicy: text(form, "overridePolicy") === "on",
      },
      await actor(),
    );
    movedId = moved.id;
  } catch (error) {
    refused(error, `${APPOINTMENTS}/${id}`, "That appointment could not be moved.");
  }
  revalidatePath(APPOINTMENTS);
  // The moved appointment is a new row, so the link has to follow it. The
  // redirect is outside the try: Next signals it by throwing, and catching
  // that would turn a successful move into a failure message.
  redirect(`${APPOINTMENTS}/${movedId}?saved=moved`);
}

export async function addGuestAction(form: FormData): Promise<void> {
  const bookingId = text(form, "bookingId");
  try {
    await addBookingParticipant.call(
      {
        bookingId,
        // "And my sister" is a real thing to book, and she has no email
        // address — so neither field is required on its own.
        email: text(form, "email") || undefined,
        name: text(form, "name") || undefined,
        seatCount: Number(text(form, "seatCount")) || 1,
      },
      await actor(),
    );
  } catch (error) {
    refused(error, `${APPOINTMENTS}/${bookingId}`, "That guest could not be added.");
  }
  revalidatePath(`${APPOINTMENTS}/${bookingId}`);
  redirect(`${APPOINTMENTS}/${bookingId}?saved=guest`);
}

export async function removeGuestAction(form: FormData): Promise<void> {
  const bookingId = text(form, "bookingId");
  try {
    await removeBookingParticipant.call({ id: text(form, "id") }, await actor());
  } catch (error) {
    refused(error, `${APPOINTMENTS}/${bookingId}`, "That guest could not be removed.");
  }
  revalidatePath(`${APPOINTMENTS}/${bookingId}`);
  redirect(`${APPOINTMENTS}/${bookingId}?saved=guest`);
}

export async function markGuestAction(form: FormData): Promise<void> {
  const bookingId = text(form, "bookingId");
  try {
    await setParticipantStatus.call(
      {
        id: text(form, "id"),
        status: text(form, "status") as "registered" | "attended" | "no_show",
      },
      await actor(),
    );
  } catch (error) {
    refused(error, `${APPOINTMENTS}/${bookingId}`, "That could not be marked.");
  }
  revalidatePath(`${APPOINTMENTS}/${bookingId}`);
  redirect(`${APPOINTMENTS}/${bookingId}?saved=guest`);
}

export async function issueWaiverAction(form: FormData): Promise<void> {
  const bookingId = text(form, "bookingId");
  let outcome: string;
  try {
    const issued = await issueBookingWaiver.call({ id: bookingId }, await actor());
    // "This service asks for no waiver" is an answer, not a failure. Telling
    // the owner what happened is the whole point of pressing the button.
    outcome = issued.contractId ? "waiver" : (issued.reason ?? "none");
  } catch (error) {
    refused(error, `${APPOINTMENTS}/${bookingId}`, "That waiver could not be sent.");
  }
  revalidatePath(`${APPOINTMENTS}/${bookingId}`);
  redirect(`${APPOINTMENTS}/${bookingId}?saved=${encodeURIComponent(outcome)}`);
}

export async function addReminderAction(form: FormData): Promise<void> {
  const bookingId = text(form, "bookingId");
  try {
    await addBookingReminder.call(
      {
        bookingId,
        channel: text(form, "channel") === "sms" ? "sms" : "email",
        offsetMin: Number(text(form, "offsetMin")) || 60,
      },
      await actor(),
    );
  } catch (error) {
    refused(error, `${APPOINTMENTS}/${bookingId}`, "That reminder could not be added.");
  }
  revalidatePath(`${APPOINTMENTS}/${bookingId}`);
  redirect(`${APPOINTMENTS}/${bookingId}?saved=reminder`);
}

export async function stopReminderAction(form: FormData): Promise<void> {
  const bookingId = text(form, "bookingId");
  try {
    await cancelBookingReminder.call({ id: text(form, "id") }, await actor());
  } catch (error) {
    refused(error, `${APPOINTMENTS}/${bookingId}`, "That reminder could not be stopped.");
  }
  revalidatePath(`${APPOINTMENTS}/${bookingId}`);
  redirect(`${APPOINTMENTS}/${bookingId}?saved=reminder`);
}

const WAITLIST = "/admin/calendars/waitlist";

export async function offerWaitlistAction(form: FormData): Promise<void> {
  const timezone = text(form, "timezone") || "UTC";
  const minutes = Number(text(form, "durationMin")) || 60;
  const back = `${WAITLIST}?calendarId=${encodeURIComponent(text(form, "calendarId"))}`;
  let outcome: string;
  try {
    const startsAt = instant(text(form, "startsAt"), timezone);
    const offered = await offerWaitlistSlot.call(
      {
        calendarId: text(form, "calendarId"),
        startsAt,
        endsAt: new Date(new Date(startsAt).getTime() + minutes * 60_000).toISOString(),
        entryId: text(form, "entryId") || undefined,
      },
      await actor(),
    );
    // "Nobody wanted it" is an answer, not a failure — telling the owner their
    // offer went nowhere is the whole point of pressing the button.
    outcome = offered.offered ? "offered" : (offered.reason ?? "none");
  } catch (error) {
    refused(error, back, "That slot could not be offered.");
  }
  revalidatePath(WAITLIST);
  redirect(`${back}&saved=${encodeURIComponent(outcome)}`);
}

export async function withdrawWaitlistAction(form: FormData): Promise<void> {
  const back = `${WAITLIST}?calendarId=${encodeURIComponent(text(form, "calendarId"))}`;
  try {
    await withdrawFromWaitlist.call({ id: text(form, "id") }, await actor());
  } catch (error) {
    refused(error, back, "That entry could not be removed.");
  }
  revalidatePath(WAITLIST);
  redirect(`${back}&saved=withdrawn`);
}

export async function moveWaitlistAction(form: FormData): Promise<void> {
  const back = `${WAITLIST}?calendarId=${encodeURIComponent(text(form, "calendarId"))}`;
  try {
    await setWaitlistPosition.call(
      { id: text(form, "id"), position: Number(text(form, "position")) || 0 },
      await actor(),
    );
  } catch (error) {
    refused(error, back, "That entry could not be moved.");
  }
  revalidatePath(WAITLIST);
  redirect(`${back}&saved=moved`);
}
