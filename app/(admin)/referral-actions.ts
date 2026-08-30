// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// The admin's referral programme and payout run. Thin (§11).
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  approveBatch,
  buildBatch,
  issueCode,
  markBatchPaid,
  saveProgram,
  saveTaxProfile,
} from "@/modules/referrals/service";

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function optional(form: FormData, name: string): string | null {
  const value = text(form, name);
  return value.length > 0 ? value : null;
}

function digits(form: FormData, name: string, fallback: number): number {
  const parsed = Number.parseInt(text(form, name), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function done(error?: unknown): never {
  if (error instanceof ServiceError) {
    redirect(`/admin/referrals?error=${encodeURIComponent(error.message)}`);
  }
  if (error instanceof Error) throw error;
  if (error !== undefined) throw new Error("referral action failed");
  redirect("/admin/referrals?saved=1");
}

export async function saveReferralProgramAction(form: FormData): Promise<void> {
  const caller = await actor();
  const id = optional(form, "id");
  try {
    await saveProgram.call(
      {
        ...(id ? { id } : {}),
        name: text(form, "name"),
        status: (text(form, "status") || "draft") as "draft" | "active" | "closed",
        cookieWindowDays: digits(form, "cookieWindowDays", 30),
        holdbackDays: digits(form, "holdbackDays", 30),
        attributionModel: (text(form, "attributionModel") || "last_touch") as
          | "last_touch"
          | "first_touch"
          | "position_based",
        // The commission config §4.3 describes. "none" is a real setting: a
        // programme paying only in loyalty points writes no cash row, and the
        // points come from a loyalty earn rule on `referral.converted`.
        commission: commissionConfig(form),
      },
      caller,
    );
  } catch (error) {
    done(error);
  }
  revalidatePath("/admin/referrals");
  done();
}

function commissionConfig(form: FormData): Record<string, unknown> {
  const kind = text(form, "commissionKind") || "none";
  if (kind === "none") return { kind: "none" };
  const value = digits(form, "commissionValue", 0);
  const cap = text(form, "commissionCap");
  return {
    kind,
    // Percent arrives as a whole number and is stored in parts-per-million,
    // which is what `commissionFor` divides by. A fixed amount is minor units.
    value: kind === "percent" ? value * 10_000 : value,
    ...(cap ? { capMinor: Number.parseInt(cap, 10) } : {}),
  };
}

export async function issueCodeAction(form: FormData): Promise<void> {
  const caller = await actor();
  try {
    await issueCode.call(
      {
        programId: text(form, "programId"),
        contactId: text(form, "contactId"),
        code: text(form, "code"),
        landingPath: optional(form, "landingPath"),
      },
      caller,
    );
  } catch (error) {
    done(error);
  }
  revalidatePath("/admin/referrals");
  done();
}

/**
 * Gather everything payable into a draft batch.
 *
 * The period is a pair of dates from the form. The end is taken to the end of
 * that day, because "the period ends on the 31st" means the 31st counts.
 */
export async function buildBatchAction(form: FormData): Promise<void> {
  const caller = await actor();
  try {
    await buildBatch.call(
      {
        periodStart: new Date(`${text(form, "periodStart")}T00:00:00`),
        periodEnd: new Date(`${text(form, "periodEnd")}T23:59:59`),
        currency: text(form, "currency") || "GBP",
        method: (text(form, "method") || "manual") as "manual" | "transfer" | "provider",
      },
      caller,
    );
  } catch (error) {
    done(error);
  }
  revalidatePath("/admin/referrals");
  done();
}

export async function approveBatchAction(form: FormData): Promise<void> {
  const caller = await actor();
  try {
    await approveBatch.call({ batchId: text(form, "batchId") }, caller);
  } catch (error) {
    done(error);
  }
  revalidatePath("/admin/referrals");
  done();
}

export async function markBatchPaidAction(form: FormData): Promise<void> {
  const caller = await actor();
  try {
    await markBatchPaid.call({ batchId: text(form, "batchId") }, caller);
  } catch (error) {
    done(error);
  }
  revalidatePath("/admin/referrals");
  done();
}

/**
 * Record what paperwork somebody owes, and whether it arrived.
 *
 * §4.13: "The platform prompts and records; it does not file." The form says
 * the same thing, so nobody mistakes this for a submission.
 */
export async function saveTaxProfileAction(form: FormData): Promise<void> {
  const caller = await actor();
  try {
    await saveTaxProfile.call(
      {
        contactId: text(form, "contactId"),
        jurisdiction: text(form, "jurisdiction"),
        formKind: text(form, "formKind"),
        state: (text(form, "state") || "not_required") as
          | "not_required"
          | "requested"
          | "collected"
          | "expired",
        thresholdMinor: digits(form, "thresholdMinor", 0),
        currency: text(form, "currency") || "GBP",
        note: optional(form, "note") ?? undefined,
      },
      caller,
    );
  } catch (error) {
    done(error);
  }
  revalidatePath("/admin/referrals");
  done();
}
