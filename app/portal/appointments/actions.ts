// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";
// The customer's own two actions on their own appointment (C6.08, §4.4).
//
// §4.4: "Customers reschedule through a signed `reschedule_token` link, with
// no login and no support email." So these run as an anonymous actor and the
// token is the whole of the authorisation — the services hold the policy, and
// nothing here can talk them out of it.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ServiceError } from "@/core/service";
import { cancelByToken, rescheduleByToken } from "@/core/scheduling/bookings";
import { zonedInstant } from "@/core/i18n/zoned";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** A local wall-clock reading from the form, as an instant in the given zone. */
function instant(local: string, timezone: string): string {
  const [datePart, timePart] = local.split("T");
  const [year, month, day] = (datePart ?? "").split("-").map(Number);
  const [hour, minute] = (timePart ?? "").split(":").map(Number);
  if (!year || !month || !day) throw new ServiceError("validation", "Choose a time.");
  return zonedInstant(timezone, {
    year,
    month,
    day,
    hour: hour ?? 0,
    minute: minute ?? 0,
  }).toISOString();
}

export async function moveMyAppointmentAction(form: FormData): Promise<void> {
  const token = text(form, "token");
  const timezone = text(form, "timezone") || "UTC";
  const minutes = Number(text(form, "durationMin")) || 60;
  const here = `/portal/appointments/${encodeURIComponent(token)}`;
  let movedTo: string;
  try {
    const startsAt = instant(text(form, "startsAt"), timezone);
    // A moved appointment is a new row with a new link, so the customer has to
    // be sent to it — the one they are holding stops working, which is the
    // point rather than a side-effect.
    const moved = await rescheduleByToken.call(
      {
        token,
        startsAt,
        endsAt: new Date(new Date(startsAt).getTime() + minutes * 60_000).toISOString(),
      },
      { kind: "anonymous" },
    );
    movedTo = moved.id;
  } catch (error) {
    // The refusal is the message: "appointments can be moved up to 48 hours
    // beforehand" is what the customer needs, and a generic failure would send
    // them to the support email §4.4 exists to avoid.
    const message =
      error instanceof ServiceError ? error.message : "That could not be moved.";
    redirect(`${here}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(here);
  redirect(`/portal/appointments/moved?id=${encodeURIComponent(movedTo)}`);
}

/**
 * The intake form, filled in by the customer for their own appointment.
 *
 * Two steps rather than one, and deliberately so: `forms.submit` records the
 * answers exactly as any other form's would — same validation, same honeypot,
 * same route onto the spine — and only then is the submission attached to the
 * booking. Teaching `forms.submit` about bookings would make the forms module
 * depend on scheduling for one caller's convenience, which is the direction
 * §11 does not allow.
 *
 * A submission that records but fails to attach is the safe half to lose: the
 * answers are on the spine, and the customer is told plainly rather than
 * shown a success page for something the business will not see attached.
 */
export async function submitIntakeAction(form: FormData): Promise<void> {
  const bookingToken = text(form, "bookingToken");
  const here = `/portal/appointments/${encodeURIComponent(bookingToken)}`;
  const rawSlug = form.get("form_slug");
  const slug = typeof rawSlug === "string" ? rawSlug : "";

  const values: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (key === "form_slug" || key === "bookingToken") continue;
    // A checkbox posts "on" when ticked and nothing at all when not, which is
    // not what a boolean field's validator expects.
    values[key] = value === "on" ? true : value;
  }

  try {
    const { submitForm } = await import("@/modules/forms/service");
    const { attachIntakeByToken } = await import("@/core/scheduling/requirements");
    const submitted = await submitForm.call(
      { slug, values, sourceUrl: `${here}/intake` },
      { kind: "anonymous" },
    );
    await attachIntakeByToken.call(
      { token: bookingToken, submissionId: submitted.submissionId },
      { kind: "anonymous" },
    );
  } catch (error) {
    const message =
      error instanceof ServiceError ? error.message : "That could not be sent.";
    redirect(`${here}/intake?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(here);
  redirect(`${here}?saved=intake`);
}

export async function cancelMyAppointmentAction(form: FormData): Promise<void> {
  const token = text(form, "token");
  const here = `/portal/appointments/${encodeURIComponent(token)}`;
  try {
    await cancelByToken.call(
      { token, reason: text(form, "reason") || undefined },
      { kind: "anonymous" },
    );
  } catch (error) {
    const message =
      error instanceof ServiceError ? error.message : "That could not be cancelled.";
    redirect(`${here}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(here);
  redirect(`${here}?saved=cancelled`);
}
