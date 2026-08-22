// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for time tracking (C6.16). Rate resolution, the one-timer rule
// and the refusal to bill an hour twice all live in the services.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { decimalToMinor } from "@/adapters/payments/currency";
import { ServiceError } from "@/core/service";
import {
  invoiceTime,
  logTime,
  removeTimeEntry,
  setTimeRate,
  startTimer,
  stopTimer,
  updateTimeEntry,
} from "@/modules/projects/time-service";
import { ownerFacing } from "./action-helpers";

const TIME = "/admin/time";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function refused(error: unknown, fallback: string): never {
  const message = error instanceof ServiceError ? ownerFacing(error.message) : fallback;
  redirect(`${TIME}?error=${encodeURIComponent(message)}`);
}

/** Hours and minutes as somebody types them: "1:30", "90", "1.5h". */
function minutesFrom(raw: string): number {
  const trimmed = raw.trim().toLowerCase();
  const clock = /^(\d+):([0-5]?\d)$/.exec(trimmed);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const hours = /^(\d+(?:\.\d+)?)\s*h$/.exec(trimmed);
  // Rounded to the minute rather than kept as a fraction: minutes are what the
  // table stores, and an hour and a half is ninety of them exactly.
  if (hours) return Math.round(Number(hours[1]) * 60);
  const plain = Number(trimmed);
  return Number.isFinite(plain) ? Math.round(plain) : 0;
}

export async function startTimerAction(form: FormData): Promise<void> {
  try {
    await startTimer.call(
      {
        description: text(form, "description"),
        projectId: text(form, "projectId") || null,
        billable: text(form, "billable") !== "off",
      },
      await actor(),
    );
  } catch (error) {
    refused(error, "The timer could not be started.");
  }
  revalidatePath(TIME);
  redirect(`${TIME}?saved=started`);
}

export async function stopTimerAction(form: FormData): Promise<void> {
  try {
    await stopTimer.call(
      { roundToMinutes: Number(text(form, "roundToMinutes")) || 1 },
      await actor(),
    );
  } catch (error) {
    refused(error, "The timer could not be stopped.");
  }
  revalidatePath(TIME);
  redirect(`${TIME}?saved=stopped`);
}

export async function logTimeAction(form: FormData): Promise<void> {
  try {
    const minutes = minutesFrom(text(form, "minutes"));
    if (minutes <= 0) {
      throw new ServiceError("validation", "Say how long it took — 90, 1:30 or 1.5h.");
    }
    await logTime.call(
      {
        description: text(form, "description"),
        minutes,
        projectId: text(form, "projectId") || null,
        billable: text(form, "billable") !== "off",
      },
      await actor(),
    );
  } catch (error) {
    refused(error, "That could not be recorded.");
  }
  revalidatePath(TIME);
  redirect(`${TIME}?saved=logged`);
}

export async function updateTimeAction(form: FormData): Promise<void> {
  try {
    const minutes = minutesFrom(text(form, "minutes"));
    await updateTimeEntry.call(
      {
        id: text(form, "id"),
        ...(minutes > 0 ? { minutes } : {}),
        billable: text(form, "billable") === "on",
      },
      await actor(),
    );
  } catch (error) {
    refused(error, "That could not be changed.");
  }
  revalidatePath(TIME);
  redirect(`${TIME}?saved=updated`);
}

export async function removeTimeAction(form: FormData): Promise<void> {
  try {
    await removeTimeEntry.call({ id: text(form, "id") }, await actor());
  } catch (error) {
    refused(error, "That could not be deleted.");
  }
  revalidatePath(TIME);
  redirect(`${TIME}?saved=removed`);
}

export async function setRateAction(form: FormData): Promise<void> {
  try {
    const currency = text(form, "currency") || "GBP";
    await setTimeRate.call(
      {
        scope: text(form, "scope") as "business" | "user" | "project",
        scopeId: text(form, "scopeId") || null,
        // Pounds and pence in, integer minor units out. Money never becomes a
        // float on the way through (§15.4).
        rateMinor: decimalToMinor(text(form, "rate") || "0", currency),
        currency,
      },
      await actor(),
    );
  } catch (error) {
    refused(error, "That rate could not be saved.");
  }
  revalidatePath(TIME);
  redirect(`${TIME}?saved=rate`);
}

export async function invoiceTimeAction(form: FormData): Promise<void> {
  let invoiceId: string;
  try {
    const entryIds = form
      .getAll("entryIds")
      .filter((value): value is string => typeof value === "string");
    if (entryIds.length === 0) {
      throw new ServiceError("validation", "Tick the hours you want to bill.");
    }
    const billed = await invoiceTime.call(
      { entryIds, currency: text(form, "currency") || "GBP" },
      await actor(),
    );
    invoiceId = billed.invoiceId;
  } catch (error) {
    refused(error, "Those hours could not be billed.");
  }
  revalidatePath(TIME);
  // Straight to the draft, because the next thing an owner does is check it
  // before issuing.
  redirect(`/admin/invoices/${invoiceId}`);
}
