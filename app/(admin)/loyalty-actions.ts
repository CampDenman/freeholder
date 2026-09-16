// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// The admin's loyalty programme. Thin, like every other caller (§11).
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  adjustPoints,
  saveEarnRule,
  saveProgram,
  saveReward,
  saveTier,
} from "@/modules/loyalty/service";

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

function maybeDigits(form: FormData, name: string): number | null {
  const raw = text(form, name);
  if (raw.length === 0) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The one number a reward kind needs, as the service's `value` shape. */
function rewardValue(form: FormData): Record<string, unknown> {
  const kind = text(form, "kind");
  const percent = maybeDigits(form, "percentOff");
  const amount = maybeDigits(form, "amountMinor");
  if (kind === "discount" && percent !== null) {
    // Percent in parts-per-million, as every other money path here stores it.
    return { percentOffPpm: percent * 10_000 };
  }
  if (amount !== null) {
    return { amountMinor: amount, currency: text(form, "currency") || "USD" };
  }
  return {};
}

function done(programId: string | null, error?: unknown): never {
  const base = programId ? `/admin/loyalty?program=${programId}` : "/admin/loyalty";
  if (error instanceof ServiceError) {
    redirect(`${base}${programId ? "&" : "?"}error=${encodeURIComponent(error.message)}`);
  }
  if (error instanceof Error) throw error;
  if (error !== undefined) throw new Error("loyalty action failed");
  redirect(`${base}${programId ? "&" : "?"}saved=1`);
}

export async function saveProgramAction(form: FormData): Promise<void> {
  const caller = await actor();
  const id = optional(form, "id");
  try {
    await saveProgram.call(
      {
        ...(id ? { id } : {}),
        name: text(form, "name"),
        pointsLabel: text(form, "pointsLabel") || "points",
        status: (text(form, "status") || "draft") as "draft" | "active" | "closed",
        earnCurrency: text(form, "earnCurrency") || "USD",
        redemptionValueCents: digits(form, "redemptionValueCents", 1),
        enrolment: (text(form, "enrolment") || "opt_in") as "automatic" | "opt_in",
        minAccountAgeDays: digits(form, "minAccountAgeDays", 0),
      },
      caller,
    );
  } catch (error) {
    done(id, error);
  }
  revalidatePath("/admin/loyalty");
  done(id);
}

export async function saveEarnRuleAction(form: FormData): Promise<void> {
  const caller = await actor();
  const programId = text(form, "programId");
  try {
    await saveEarnRule.call(
      {
        ...(optional(form, "id") ? { id: text(form, "id") } : {}),
        programId,
        name: text(form, "name"),
        eventType: text(form, "eventType"),
        formula: (text(form, "formula") || "fixed") as
          | "fixed"
          | "per_currency_unit"
          | "multiplier",
        points: digits(form, "points", 0),
        capPerPeriod: maybeDigits(form, "capPerPeriod"),
        capPeriodDays: digits(form, "capPeriodDays", 30),
        priority: digits(form, "priority", 0),
        active: (text(form, "active") || "yes") as "yes" | "no",
      },
      caller,
    );
  } catch (error) {
    done(programId, error);
  }
  revalidatePath("/admin/loyalty");
  done(programId);
}

export async function saveTierAction(form: FormData): Promise<void> {
  const caller = await actor();
  const programId = text(form, "programId");
  try {
    await saveTier.call(
      {
        ...(optional(form, "id") ? { id: text(form, "id") } : {}),
        programId,
        name: text(form, "name"),
        thresholdBasis: (text(form, "thresholdBasis") || "points_earned") as
          | "points_earned"
          | "lifetime_spend",
        threshold: digits(form, "threshold", 0),
        // Zero is all time; the service defaults to a rolling year.
        windowDays: digits(form, "windowDays", 365),
        position: digits(form, "position", 0),
      },
      caller,
    );
  } catch (error) {
    done(programId, error);
  }
  revalidatePath("/admin/loyalty");
  done(programId);
}

export async function saveRewardAction(form: FormData): Promise<void> {
  const caller = await actor();
  const programId = text(form, "programId");
  try {
    await saveReward.call(
      {
        ...(optional(form, "id") ? { id: text(form, "id") } : {}),
        programId,
        name: text(form, "name"),
        kind: text(form, "kind") as
          | "discount"
          | "free_product"
          | "free_shipping"
          | "gift_card"
          | "pass_credits"
          | "donation",
        costPoints: digits(form, "costPoints", 1),
        // A discount with no value is a reward that redeems into nothing, so
        // the form asks for whichever number the kind actually needs and the
        // service validates the pairing.
        value: rewardValue(form),
        status: (text(form, "status") || "draft") as "draft" | "active" | "retired",
        perContactLimit: maybeDigits(form, "perContactLimit"),
        stock: maybeDigits(form, "stock"),
      },
      caller,
    );
  } catch (error) {
    done(programId, error);
  }
  revalidatePath("/admin/loyalty");
  done(programId);
}

/**
 * A manual correction, which §4.13 requires be a ledger row like any other.
 *
 * The note is mandatory in the service, and the form marks it required too:
 * an adjustment nobody explained is the one row in a points ledger that
 * cannot be defended when a customer asks about it.
 */
export async function adjustPointsAction(form: FormData): Promise<void> {
  const caller = await actor();
  const programId = text(form, "programId");
  try {
    await adjustPoints.call(
      {
        programId,
        contactId: text(form, "contactId"),
        delta: digits(form, "delta", 0),
        note: text(form, "note"),
      },
      caller,
    );
  } catch (error) {
    done(programId, error);
  }
  revalidatePath("/admin/loyalty");
  done(programId);
}
