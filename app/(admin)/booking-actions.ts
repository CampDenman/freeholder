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
  createBooking,
  rescheduleBooking,
  setBookingStatus,
} from "@/core/scheduling/bookings";
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
