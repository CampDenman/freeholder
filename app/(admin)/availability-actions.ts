// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for the availability editor (C6.02). The week arrives as a
// whole because that is how the service takes it, and a day left empty is a
// day with no hours rather than a row to delete.

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  addAvailabilityException,
  removeAvailabilityException,
  setAvailability,
} from "@/core/scheduling/availability-service";
import { ownerFacing } from "./action-helpers";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function refused(error: unknown, calendarId: string, fallback: string): never {
  const message = error instanceof ServiceError ? ownerFacing(error.message) : fallback;
  redirect(`/admin/calendars/${calendarId}?error=${encodeURIComponent(message)}`);
}

export async function setAvailabilityAction(form: FormData): Promise<void> {
  const calendarId = text(form, "calendarId");
  const rules: {
    weekday: number;
    starts: string;
    ends: string;
    kind: "bookable" | "on_call";
  }[] = [];
  for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
    for (const [prefix, kind] of [
      ["", "bookable"],
      ["oncall-", "on_call"],
    ] as const) {
      const starts = text(form, `${prefix}open-${weekday}`);
      const ends = text(form, `${prefix}close-${weekday}`);
      // Both or neither. Half a pair is somebody mid-edit, not an instruction.
      if (!starts || !ends) continue;
      rules.push({ weekday, starts, ends, kind });
    }
  }

  try {
    await setAvailability.call({ calendarId, rules }, await actor());
  } catch (error) {
    refused(error, calendarId, "Those hours could not be saved.");
  }
  revalidatePath(`/admin/calendars/${calendarId}`);
  redirect(`/admin/calendars/${calendarId}?saved=hours`);
}

export async function addExceptionAction(form: FormData): Promise<void> {
  const calendarId = text(form, "calendarId");
  const kind = text(form, "kind");
  try {
    await addAvailabilityException.call(
      {
        calendarId,
        startsOn: text(form, "startsOn"),
        endsOn: text(form, "endsOn") || undefined,
        kind: kind === "open" || kind === "reduced" ? kind : "closed",
        // A closure carries no hours, and sending empty strings would be
        // asking the service to refuse something nobody typed.
        starts: text(form, "starts") || undefined,
        ends: text(form, "ends") || undefined,
        reason: text(form, "reason") || undefined,
      },
      await actor(),
    );
  } catch (error) {
    refused(error, calendarId, "That could not be added.");
  }
  revalidatePath(`/admin/calendars/${calendarId}`);
  redirect(`/admin/calendars/${calendarId}?saved=exception`);
}

export async function removeExceptionAction(form: FormData): Promise<void> {
  const calendarId = text(form, "calendarId");
  try {
    await removeAvailabilityException.call({ id: text(form, "id") }, await actor());
  } catch (error) {
    refused(error, calendarId, "That could not be removed.");
  }
  revalidatePath(`/admin/calendars/${calendarId}`);
  redirect(`/admin/calendars/${calendarId}`);
}
