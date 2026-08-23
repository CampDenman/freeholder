// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Thin callers for recurring invoices and chasing (C6.17). The cadence
// arithmetic, the skip-the-backlog rule and the never-chase-a-paid-invoice
// rule all live in the services.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { decimalToMinor } from "@/adapters/payments/currency";
import { ServiceError } from "@/core/service";
import {
  createSchedule,
  runSchedules,
  scheduleInvoiceReminders,
  updateSchedule,
} from "@/modules/invoicing/recurring-service";
import { ownerFacing } from "./action-helpers";

const RECURRING = "/admin/invoices/recurring";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function refused(error: unknown, path: string, fallback: string): never {
  const message = error instanceof ServiceError ? ownerFacing(error.message) : fallback;
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function createScheduleAction(form: FormData): Promise<void> {
  try {
    const currency = text(form, "currency") || "GBP";
    await createSchedule.call(
      {
        contactId: text(form, "contactId"),
        name: text(form, "name"),
        currency,
        cadence: (text(form, "cadence") || "monthly") as
          | "weekly"
          | "monthly"
          | "quarterly"
          | "yearly",
        lines: [
          {
            description: text(form, "description"),
            quantityMicros: 1_000_000,
            // Pounds and pence in, integer minor units out (§15.4).
            unitAmountMinor: decimalToMinor(text(form, "amount") || "0", currency),
          },
        ],
        dueInDays: Number(text(form, "dueInDays")) || 14,
        // Off unless the owner ticks it: an invoice going to a customer
        // without anybody looking is the one automation they cannot take back.
        autoIssue: text(form, "autoIssue") === "on",
      },
      await actor(),
    );
  } catch (error) {
    refused(error, RECURRING, "That schedule could not be set up.");
  }
  revalidatePath(RECURRING);
  redirect(`${RECURRING}?saved=created`);
}

export async function setScheduleStatusAction(form: FormData): Promise<void> {
  try {
    await updateSchedule.call(
      {
        id: text(form, "id"),
        status: text(form, "status") as "active" | "paused" | "ended",
      },
      await actor(),
    );
  } catch (error) {
    refused(error, RECURRING, "That could not be changed.");
  }
  revalidatePath(RECURRING);
  redirect(`${RECURRING}?saved=status`);
}

export async function runSchedulesAction(): Promise<void> {
  try {
    await runSchedules.call({}, await actor());
  } catch (error) {
    refused(error, RECURRING, "Those could not be raised.");
  }
  revalidatePath(RECURRING);
  redirect(`${RECURRING}?saved=ran`);
}

export async function scheduleRemindersAction(form: FormData): Promise<void> {
  const invoiceId = text(form, "invoiceId");
  try {
    const offsets = form
      .getAll("offsetDays")
      .filter((value): value is string => typeof value === "string")
      .map(Number)
      .filter((value) => Number.isFinite(value));
    if (offsets.length === 0) {
      throw new ServiceError("validation", "Choose when to chase it.");
    }
    await scheduleInvoiceReminders.call({ invoiceId, offsetDays: offsets }, await actor());
  } catch (error) {
    refused(error, `/admin/invoices/${invoiceId}`, "Those reminders could not be set.");
  }
  revalidatePath(`/admin/invoices/${invoiceId}`);
  redirect(`/admin/invoices/${invoiceId}?saved=reminders`);
}
