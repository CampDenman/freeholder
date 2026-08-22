// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for the audiences screen (C6.05). Which proof each kind of
// audience needs, and what an audience may book, live in the services.

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  createAudience,
  removeAudience,
  setAudienceCalendars,
  setAudienceHours,
  setAudienceServices,
} from "@/core/scheduling/audiences";
import { ownerFacing } from "./action-helpers";

const AUDIENCES = "/admin/calendars/audiences";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optionalNumber(form: FormData, key: string): number | undefined {
  const raw = text(form, key);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function refused(error: unknown, fallback: string): never {
  const message = error instanceof ServiceError ? ownerFacing(error.message) : fallback;
  redirect(`${AUDIENCES}?error=${encodeURIComponent(message)}`);
}

export async function createAudienceAction(form: FormData): Promise<void> {
  const who = text(form, "who");
  const hours = text(form, "hours");
  try {
    await createAudience.call(
      {
        name: text(form, "name"),
        who:
          who === "token" || who === "tag" || who === "signed_in" ? who : "public",
        // Only a tagged audience carries a tag; the service refuses the rest.
        contactTag: who === "tag" ? text(form, "contactTag") || undefined : undefined,
        hours: hours === "any" || hours === "custom" ? hours : "calendar",
        minNoticeMin: optionalNumber(form, "minNoticeMin"),
        bookingHorizonDays: optionalNumber(form, "bookingHorizonDays"),
        position: optionalNumber(form, "position") ?? 0,
      },
      await actor(),
    );
  } catch (error) {
    refused(error, "That audience could not be created.");
  }
  revalidatePath(AUDIENCES);
  redirect(`${AUDIENCES}?saved=created`);
}

export async function setAudienceServicesAction(form: FormData): Promise<void> {
  try {
    await setAudienceServices.call(
      {
        id: text(form, "id"),
        serviceOfferingIds: form.getAll("serviceOfferingIds").filter(
          (value): value is string => typeof value === "string" && value.length > 0,
        ),
      },
      await actor(),
    );
  } catch (error) {
    refused(error, "That could not be saved.");
  }
  revalidatePath(AUDIENCES);
  redirect(`${AUDIENCES}?saved=services`);
}

export async function setAudienceCalendarsAction(form: FormData): Promise<void> {
  try {
    await setAudienceCalendars.call(
      {
        id: text(form, "id"),
        calendarIds: form.getAll("calendarIds").filter(
          (value): value is string => typeof value === "string" && value.length > 0,
        ),
      },
      await actor(),
    );
  } catch (error) {
    refused(error, "That could not be saved.");
  }
  revalidatePath(AUDIENCES);
  redirect(`${AUDIENCES}?saved=calendars`);
}

export async function setAudienceHoursAction(form: FormData): Promise<void> {
  const hours = text(form, "hours");
  const rules: { weekday: number; starts: string; ends: string }[] = [];
  for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
    const starts = text(form, `open-${weekday}`);
    const ends = text(form, `close-${weekday}`);
    // Both or neither: half a pair is somebody mid-edit, not an instruction.
    if (starts && ends) rules.push({ weekday, starts, ends });
  }
  try {
    await setAudienceHours.call(
      {
        id: text(form, "id"),
        hours: hours === "any" || hours === "custom" ? hours : "calendar",
        rules,
      },
      await actor(),
    );
  } catch (error) {
    refused(error, "Those hours could not be saved.");
  }
  revalidatePath(AUDIENCES);
  redirect(`${AUDIENCES}?saved=hours`);
}

export async function removeAudienceAction(form: FormData): Promise<void> {
  try {
    await removeAudience.call({ id: text(form, "id") }, await actor());
  } catch (error) {
    refused(error, "That audience could not be removed.");
  }
  revalidatePath(AUDIENCES);
  redirect(AUDIENCES);
}
