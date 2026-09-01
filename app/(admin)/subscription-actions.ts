// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// Plans and the people on them. Thin, like every other caller (§11).
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  cancelSubscription,
  pauseSubscription,
  resumeSubscription,
  savePlan,
} from "@/modules/subscriptions/service";

async function actor() {
  return actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function digits(form: FormData, name: string, fallback: number): number {
  const value = Number(text(form, name));
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function done(error?: unknown, flag = "saved"): never {
  if (error instanceof ServiceError) {
    redirect(`/admin/subscriptions?error=${encodeURIComponent(error.message)}`);
  }
  if (error instanceof Error) throw error;
  if (error !== undefined) throw new Error("subscription action failed");
  redirect(`/admin/subscriptions?${flag}=1`);
}

export async function savePlanAction(form: FormData): Promise<void> {
  const caller = await actor();
  const id = text(form, "id");
  try {
    await savePlan.call(
      {
        ...(id ? { id } : {}),
        productId: text(form, "productId"),
        name: text(form, "name"),
        interval: (text(form, "interval") || "month") as "day" | "week" | "month" | "year",
        intervalCount: digits(form, "intervalCount", 1) || 1,
        trialDays: digits(form, "trialDays", 0),
        setupFeeMinor: digits(form, "setupFeeMinor", 0),
        cancelBehaviour: (text(form, "cancelBehaviour") || "period_end") as
          | "period_end"
          | "immediate",
        status: (text(form, "status") || "draft") as "draft" | "active" | "archived",
      },
      caller,
    );
  } catch (error) {
    done(error);
  }
  done();
}

export async function pauseSubscriptionAction(form: FormData): Promise<void> {
  const caller = await actor();
  try {
    await pauseSubscription.call({ id: text(form, "id") }, caller);
  } catch (error) {
    done(error);
  }
  done(undefined, "paused");
}

export async function resumeSubscriptionAction(form: FormData): Promise<void> {
  const caller = await actor();
  try {
    await resumeSubscription.call({ id: text(form, "id") }, caller);
  } catch (error) {
    done(error);
  }
  done(undefined, "resumed");
}

export async function cancelSubscriptionAction(form: FormData): Promise<void> {
  const caller = await actor();
  try {
    await cancelSubscription.call(
      {
        id: text(form, "id"),
        // The owner's override of the plan's stated behaviour, for the case
        // they are also refunding.
        ...(text(form, "immediately") === "1" ? { immediately: true } : {}),
      },
      caller,
    );
  } catch (error) {
    done(error);
  }
  done(undefined, "cancelled");
}
