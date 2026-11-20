// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Adding and correcting a tracked charge (MASTER.md §43 C12.40).
//
// One action for both, because create and edit differ by exactly one field.
// Two actions would be two places for the money parsing to drift.
"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { decimalToMinor } from "@/adapters/payments/currency";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  trackMySubscription,
  updateMyTrackedSubscription,
} from "@/modules/renewal-alerts/service";
import { RENEWAL_CYCLES } from "@/modules/renewal-alerts/service";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function saveRenewalAction(form: FormData): Promise<void> {
  const who = await actorFromToken((await cookies()).get(SESSION_COOKIE)?.value);
  const id = text(form, "id");
  const back = id ? `/portal/renewals/${id}/edit` : "/portal/renewals/new";

  const currency = (text(form, "currency") || "USD").toUpperCase();

  // Money is parsed here rather than in the service because the service's
  // contract is minor units — the unambiguous thing an API caller should send
  // — and a decimal typed by a person is a presentation concern. `decimalToMinor`
  // is the shared parser (§15.4: no float math on money, one implementation of
  // the exponent rules), and it raises an adapter error written for a payment
  // provider, so it is caught and said again in the member's own words.
  let costMinor: number;
  try {
    costMinor = decimalToMinor(text(form, "amount"), currency);
  } catch {
    return redirect(`${back}?error=amount`);
  }

  const firstCharge = text(form, "firstChargeAt");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstCharge)) {
    return redirect(`${back}?error=date`);
  }

  const askedCycle = text(form, "cycle");
  const cycle = (RENEWAL_CYCLES as readonly string[]).includes(askedCycle)
    ? (askedCycle as (typeof RENEWAL_CYCLES)[number])
    : "monthly";

  const intervalDays = Number(text(form, "customIntervalDays"));
  const customIntervalDays =
    Number.isInteger(intervalDays) && intervalDays > 0 ? intervalDays : null;

  // The service is still the authority on this rule — it refuses the same
  // combination, and an API caller never reaches this file. This exists only so
  // the form can say which field is wrong instead of "that could not be saved".
  if (cycle === "custom" && customIntervalDays === null) {
    return redirect(`${back}?error=interval`);
  }

  const askedAlertDays = text(form, "alertDays");
  // Absent means "leave it at the default"; a typed 0 means "tell me on the
  // day", which is a real answer and must not be read as absent.
  const alertDays = askedAlertDays === "" ? 3 : Number(askedAlertDays);

  const input = {
    name: text(form, "name"),
    costMinor,
    currency,
    cycle,
    customIntervalDays,
    firstChargeAt: firstCharge,
    alertDays,
    notes: text(form, "notes") || null,
  };

  try {
    if (id) await updateMyTrackedSubscription.call({ id, ...input }, who);
    else await trackMySubscription.call(input, who);
  } catch (error) {
    if (error instanceof ServiceError) return redirect(`${back}?error=1`);
    throw error;
  }
  // The room's count feeds the portal navigation, so the shell is revalidated
  // and not only the page.
  revalidatePath("/portal", "layout");
  redirect("/portal/renewals?saved=1");
}
