// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Scheduled accounting exports (C9.32). Thin, like every other caller (§11).
//
// "Run now" is two calls rather than one, and that is the same decision the
// job makes: building the file and delivering it are two transactions, so that
// a failed send cannot roll back the evidence that it failed. A server action
// is outside any transaction, which is exactly what lets it do that.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  deleteExport,
  queueExportRunDelivery,
  runExport,
  saveExport,
} from "@/modules/reporting/service";

const EXPORTS = "/admin/reports/exports";

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function optional(form: FormData, name: string): string | null {
  return text(form, name) || null;
}

function done(query: string, error?: unknown): never {
  if (error instanceof ServiceError) {
    redirect(`${EXPORTS}?error=${encodeURIComponent(error.message)}`);
  }
  if (error instanceof Error) throw error;
  if (error !== undefined) throw new Error("export action failed");
  redirect(`${EXPORTS}?${query}`);
}

/** One address per line, so the field behaves like the list it represents. */
function addresses(form: FormData): string[] {
  return text(form, "recipients")
    .split(/[\n,;]+/)
    .map((each) => each.trim())
    .filter(Boolean);
}

export async function saveExportAction(form: FormData): Promise<void> {
  const caller = await actor();
  const id = text(form, "id");
  try {
    await saveExport.call(
      {
        ...(id ? { id } : {}),
        name: text(form, "name"),
        shape: text(form, "shape") as "csv" | "quickbooks" | "xero",
        basis: text(form, "basis") as "paid" | "issued",
        currency: text(form, "currency"),
        period: text(form, "period") as
          | "previous_week"
          | "previous_month"
          | "previous_quarter",
        timezone: text(form, "timezone") || "UTC",
        scheduled: form.get("scheduled") === "on",
        recipients: addresses(form),
        dateFormat: text(form, "dateFormat") as "iso" | "dmy" | "mdy",
        itemCode: optional(form, "itemCode"),
        accountCode: optional(form, "accountCode"),
        taxCode: optional(form, "taxCode"),
      },
      caller,
    );
  } catch (error) {
    done("", error);
  }
  done("saved=1");
}

export async function deleteExportAction(form: FormData): Promise<void> {
  const caller = await actor();
  try {
    await deleteExport.call(
      { id: text(form, "id"), confirm: form.get("confirm") === "1" },
      caller,
    );
  } catch (error) {
    done("", error);
  }
  done("deleted=1");
}

export async function runExportAction(form: FormData): Promise<void> {
  const caller = await actor();
  const id = text(form, "id");
  try {
    const run = await runExport.call({ id, trigger: "manual" }, caller);
    // Committed. Whatever the delivery does next, the run exists and says so.
    if (run.status === "pending") {
      await queueExportRunDelivery.call({ runId: run.id }, caller);
    }
  } catch (error) {
    done("", error);
  }
  done(`ran=1&id=${encodeURIComponent(id)}`);
}

export async function retryExportDeliveryAction(form: FormData): Promise<void> {
  const caller = await actor();
  const id = text(form, "id");
  try {
    await queueExportRunDelivery.call({ runId: text(form, "runId") }, caller);
  } catch (error) {
    done("", error);
  }
  done(`ran=1&id=${encodeURIComponent(id)}`);
}
