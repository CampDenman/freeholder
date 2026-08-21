// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for the calendars workspace (C6.01). The rules — one business
// calendar, a person's calendar having a person, archiving rather than
// deleting — live in the services shared with HTTP and MCP.

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  archiveCalendar,
  createCalendar,
  updateCalendar,
} from "@/core/scheduling/service";
import { ownerFacing } from "./action-helpers";

const CALENDARS = "/admin/calendars";

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

/** Refusals are shown, not swallowed: they are how an owner learns the rules. */
function refused(error: unknown, fallback: string): never {
  const message = error instanceof ServiceError ? ownerFacing(error.message) : fallback;
  redirect(`${CALENDARS}?error=${encodeURIComponent(message)}`);
}

export async function createCalendarAction(form: FormData): Promise<void> {
  const kind = text(form, "kind");
  try {
    await createCalendar.call(
      {
        kind: kind === "person" || kind === "resource" ? kind : "business",
        name: text(form, "name"),
        userId: text(form, "userId") || undefined,
        timezone: text(form, "timezone") || undefined,
        capacityDefault: optionalNumber(form, "capacityDefault"),
      },
      await actor(),
    );
  } catch (error) {
    refused(error, "That calendar could not be created.");
  }
  revalidatePath(CALENDARS);
  redirect(`${CALENDARS}?saved=created`);
}

export async function updateCalendarAction(form: FormData): Promise<void> {
  try {
    await updateCalendar.call(
      {
        id: text(form, "id"),
        name: text(form, "name") || undefined,
        timezone: text(form, "timezone") || undefined,
        capacityDefault: optionalNumber(form, "capacityDefault"),
        bookingHorizonDays: optionalNumber(form, "bookingHorizonDays"),
        minNoticeMin: optionalNumber(form, "minNoticeMin"),
      },
      await actor(),
    );
  } catch (error) {
    refused(error, "That change could not be saved.");
  }
  revalidatePath(CALENDARS);
  redirect(`${CALENDARS}?saved=updated`);
}

export async function archiveCalendarAction(form: FormData): Promise<void> {
  try {
    await archiveCalendar.call(
      { id: text(form, "id"), archived: text(form, "archived") === "true" },
      await actor(),
    );
  } catch (error) {
    refused(error, "That calendar could not be changed.");
  }
  revalidatePath(CALENDARS);
  redirect(CALENDARS);
}
