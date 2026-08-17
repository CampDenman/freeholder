// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/core/auth/sessions";
import { actorFromToken } from "@/core/http/actor";
import { ServiceError } from "@/core/service";
import {
  addEventSession,
  addEventTicket,
  cancelEvent,
  cancelRegistration,
  checkInRegistration,
  createEvent,
  publishEvent,
} from "@/modules/events/service";

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function actor() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const resolved = token ? await actorFromToken(token) : null;
  if (!resolved) throw new ServiceError("permission", "Sign in to continue.");
  return resolved;
}

function fail(path: string, error: unknown): never {
  const message = error instanceof ServiceError ? error.message : "Something went wrong.";
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function eventAction(form: FormData): Promise<void> {
  const intent = field(form, "intent");
  const signed = await actor();
  try {
    if (intent === "create") {
      const created = await createEvent.call(
        {
          name: field(form, "name"),
          slug: field(form, "slug"),
          summary: field(form, "summary") || undefined,
          venueName: field(form, "venueName") || undefined,
          venueAddress: field(form, "venueAddress") || undefined,
        },
        signed,
      );
      revalidatePath("/admin/events");
      redirect(`/admin/events/${created.id}`);
    }
    const id = field(form, "id");
    const expectedVersion = Number(field(form, "expectedVersion") || 0);
    if (intent === "publish") await publishEvent.call({ id, expectedVersion }, signed);
    if (intent === "cancel") await cancelEvent.call({ id, expectedVersion }, signed);
    if (intent === "session") {
      await addEventSession.call(
        {
          eventId: id,
          startsAt: new Date(field(form, "startsAt")),
          endsAt: new Date(field(form, "endsAt")),
          timezone: field(form, "timezone") || "UTC",
          capacity: Number(field(form, "capacity") || 0),
          waitlistEnabled: field(form, "waitlistEnabled") === "on",
        },
        signed,
      );
    }
    if (intent === "ticket") {
      await addEventTicket.call(
        {
          eventId: id,
          name: field(form, "ticketName"),
          priceMinor: Number(field(form, "priceMinor") || 0),
          currency: field(form, "currency") || "CAD",
        },
        signed,
      );
    }
    if (intent === "checkin") await checkInRegistration.call({ id: field(form, "registrationId") }, signed);
    if (intent === "cancelRegistration") {
      await cancelRegistration.call({ id: field(form, "registrationId") }, signed);
    }
    revalidatePath(`/admin/events/${id || ""}`);
    revalidatePath("/admin/events");
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    fail("/admin/events", error);
  }
}
