// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Reminding somebody they have an appointment (MASTER.md §4.4, §4.14; C6.09).
//
// A reminder is **transactional**. §4.14 draws the line and this file stays on
// the right side of it: "marketing texts require express opt-in with the terms
// shown at the moment of collection; transactional messages — a booking
// confirmation, a delivery notification, an OTP — ride the existing
// relationship." Somebody who booked an appointment asked to be told about it.
//
// What that does *not* excuse:
//
//   - **Suppression is absolute.** A bounced or complained-about address stays
//     unmailed whatever the purpose; `sendMail` refuses before any provider
//     call and the refusal is recorded as a skip rather than swallowed.
//   - **SMS needs more than the relationship.** §4.14 calls a text "a personal
//     medium that people *read*", and the full machinery for it — numbers,
//     registration, quiet hours, STOP handling — is §4.14's own workstream.
//     Until that lands, an SMS reminder is scheduled, and refused at send time
//     with the reason recorded, rather than half-sent through an adapter that
//     cannot honour an opt-out.
//
// Every attempt lands in the row. "Was she reminded?" is a question an owner
// asks when somebody does not turn up, and a scheduling rule that says a
// reminder *would* have been sent is not an answer.
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { contacts } from "@/core/contacts/schema";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { sendMail } from "@/core/mail/service";
import {
  bookingReminders,
  bookings,
  calendars,
  HOLDING_STATUSES,
  REMINDER_CHANNELS,
  REMINDER_STATUSES,
} from "@/core/scheduling/schema";
import { requirementsFor } from "@/core/scheduling/requirements";
import { currentBusiness } from "@/core/settings/read";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";

/** A reminder for a time already past is a reminder nobody wants. */
function futureOnly(sendAt: Date): boolean {
  return sendAt.getTime() > Date.now();
}

const reminderRow = row({
  id: uuid,
  bookingId: uuid,
  channel: z.enum(REMINDER_CHANNELS),
  offsetMin: z.number().int(),
  sendAt: timestamp,
  sentAt: timestamp.nullable(),
  status: z.enum(REMINDER_STATUSES),
  skipReason: z.string().nullable(),
});

/**
 * Put this booking's reminders where the sender will find them.
 *
 * Upserted on (booking, channel, offset), which is what makes rescheduling a
 * *re-computation* rather than a duplication: the same three reminders move
 * with the appointment instead of accumulating one set per move. A reminder
 * already sent is left alone — it happened, and moving its time would be
 * rewriting history.
 */
export async function scheduleRemindersFor(
  ctx: ServiceContext,
  booking: { id: string; startsAt: Date; serviceOfferingId: string | null },
): Promise<{ scheduled: number }> {
  const needs = await requirementsFor(ctx, booking.serviceOfferingId);
  if (needs.reminderOffsetsMin.length === 0) return { scheduled: 0 };

  let scheduled = 0;
  for (const offsetMin of needs.reminderOffsetsMin) {
    const sendAt = new Date(booking.startsAt.getTime() - offsetMin * 60_000);
    // A booking made two hours before it starts does not get a day-before
    // reminder retroactively; it simply does not get that one.
    if (!futureOnly(sendAt)) continue;
    await ctx.tx
      .insert(bookingReminders)
      .values({ bookingId: booking.id, channel: "email", offsetMin, sendAt })
      .onConflictDoUpdate({
        target: [
          bookingReminders.bookingId,
          bookingReminders.channel,
          bookingReminders.offsetMin,
        ],
        set: { sendAt, updatedAt: sql`now()` },
        where: eq(bookingReminders.status, "scheduled"),
      });
    scheduled += 1;
  }
  return { scheduled };
}

/** Drop the reminders for an appointment that is no longer going ahead. */
export async function cancelRemindersFor(
  ctx: ServiceContext,
  bookingId: string,
): Promise<void> {
  await ctx.tx
    .update(bookingReminders)
    .set({
      status: "skipped",
      skipReason: "The appointment was cancelled.",
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(bookingReminders.bookingId, bookingId),
        eq(bookingReminders.status, "scheduled"),
      ),
    );
}

export const listBookingReminders = defineService({
  name: "bookings.reminders",
  summary: "What has been sent about an appointment, and what is still to come.",
  kind: "query",
  permission: "scoped",
  input: z.object({ bookingId: z.uuid() }),
  output: listed(reminderRow),
  handler: (input, ctx) =>
    ctx.tx
      .select({
        id: bookingReminders.id,
        bookingId: bookingReminders.bookingId,
        channel: bookingReminders.channel,
        offsetMin: bookingReminders.offsetMin,
        sendAt: bookingReminders.sendAt,
        sentAt: bookingReminders.sentAt,
        status: bookingReminders.status,
        skipReason: bookingReminders.skipReason,
      })
      .from(bookingReminders)
      .where(eq(bookingReminders.bookingId, input.bookingId))
      .orderBy(bookingReminders.sendAt),
});

export const addBookingReminder = defineService({
  name: "bookings.addReminder",
  summary: "Schedule one more reminder for an appointment.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "message",
  input: z.object({
    bookingId: z.uuid(),
    channel: z.enum(REMINDER_CHANNELS).default("email"),
    offsetMin: z.number().int().min(0).max(43_200),
  }),
  output: reminderRow,
  handler: async (input, ctx) => {
    const [booking] = await ctx.tx
      .select({ id: bookings.id, startsAt: bookings.startsAt })
      .from(bookings)
      .where(eq(bookings.id, input.bookingId))
      .limit(1);
    if (!booking) throw new ServiceError("not_found", "No such appointment.");
    const sendAt = new Date(booking.startsAt.getTime() - input.offsetMin * 60_000);
    if (!futureOnly(sendAt)) {
      throw new ServiceError(
        "validation",
        "That reminder would already have been due. Choose a shorter notice.",
      );
    }
    const [created] = await ctx.tx
      .insert(bookingReminders)
      .values({
        bookingId: booking.id,
        channel: input.channel,
        offsetMin: input.offsetMin,
        sendAt,
      })
      .onConflictDoUpdate({
        target: [
          bookingReminders.bookingId,
          bookingReminders.channel,
          bookingReminders.offsetMin,
        ],
        set: { sendAt, status: "scheduled", skipReason: null, updatedAt: sql`now()` },
      })
      .returning();
    ctx.setSubject("booking", booking.id);
    return created!;
  },
});

export const cancelBookingReminder = defineService({
  name: "bookings.cancelReminder",
  summary: "Stop one reminder going out.",
  kind: "mutation",
  permission: "scoped",
  agentCallable: false,
  writeClass: "write",
  input: z.object({ id: z.uuid() }),
  output: row({ id: uuid }),
  handler: async (input, ctx) => {
    const [updated] = await ctx.tx
      .update(bookingReminders)
      .set({
        status: "skipped",
        skipReason: "Cancelled by the business.",
        updatedAt: sql`now()`,
      })
      .where(
        and(eq(bookingReminders.id, input.id), eq(bookingReminders.status, "scheduled")),
      )
      .returning({ id: bookingReminders.id });
    if (!updated) {
      throw new ServiceError("conflict", "That reminder has already gone or been stopped.");
    }
    return updated;
  },
});

/**
 * Send every reminder that has come due.
 *
 * Runs on its own connection rather than inside a caller's transaction: each
 * reminder is independent, and one unreachable address must not roll back the
 * fifty that went out fine.
 */
export async function sendDueReminders(): Promise<{
  sent: number;
  skipped: number;
  failed: number;
}> {
  const due = await db()
    .select({
      id: bookingReminders.id,
      channel: bookingReminders.channel,
      offsetMin: bookingReminders.offsetMin,
      bookingId: bookings.id,
      startsAt: bookings.startsAt,
      status: bookings.status,
      timezoneAtBooking: bookings.timezoneAtBooking,
      locationDetail: bookings.locationDetail,
      rescheduleToken: bookings.rescheduleToken,
      calendarName: calendars.name,
      contactName: contacts.name,
      contactEmail: contacts.email,
    })
    .from(bookingReminders)
    .innerJoin(bookings, eq(bookings.id, bookingReminders.bookingId))
    .innerJoin(calendars, eq(calendars.id, bookings.calendarId))
    .innerJoin(contacts, eq(contacts.id, bookings.contactId))
    .where(
      and(
        eq(bookingReminders.status, "scheduled"),
        lte(bookingReminders.sendAt, new Date()),
        isNull(bookingReminders.sentAt),
      ),
    )
    .limit(500);

  const business = await currentBusiness();
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const reminder of due) {
    const skip = async (reason: string): Promise<void> => {
      skipped += 1;
      await db()
        .update(bookingReminders)
        .set({ status: "skipped", skipReason: reason, updatedAt: sql`now()` })
        .where(eq(bookingReminders.id, reminder.id));
    };

    // An appointment that has been cancelled, completed or moved out from
    // under this row is one nobody should be reminded about.
    if (!HOLDING_STATUSES.includes(reminder.status as (typeof HOLDING_STATUSES)[number])) {
      await skip("The appointment was no longer going ahead.");
      continue;
    }
    if (reminder.channel === "sms") {
      // Honest refusal rather than a half-implementation. §4.14 owns numbers,
      // registration, quiet hours and STOP handling, and sending a text
      // without them is sending one that cannot be stopped.
      await skip("Text reminders need the messaging module, which is not built yet.");
      continue;
    }
    if (!reminder.contactEmail) {
      await skip("No email address on the contact.");
      continue;
    }

    const when = new Intl.DateTimeFormat(business?.defaultLocale ?? "en", {
      timeZone: reminder.timezoneAtBooking,
      dateStyle: "full",
      timeStyle: "short",
    }).format(reminder.startsAt);
    const lines = [
      `You have an appointment with ${business?.name ?? "us"}.`,
      "",
      `${when} (${reminder.timezoneAtBooking})`,
      reminder.calendarName,
      reminder.locationDetail ?? "",
      "",
      // The same link §4.4 promises: no login, no support email.
      reminder.rescheduleToken
        ? `Need to change it? ${env().APP_URL.replace(/\/+$/, "")}/portal/appointments/${reminder.rescheduleToken}`
        : "",
    ].filter(Boolean);

    try {
      await db().transaction((tx) =>
        sendMail(
          tx,
          {
            to: reminder.contactEmail!,
            subject: `Reminder: ${reminder.calendarName} on ${when}`,
            text: lines.join("\n"),
          },
          {
            purpose: "transactional",
            // Stable per reminder row, so a retried job never sends twice.
            idempotencyKey: `booking-reminder:${reminder.id}`,
          },
        ),
      );
      sent += 1;
      await db()
        .update(bookingReminders)
        .set({ status: "sent", sentAt: new Date(), updatedAt: sql`now()` })
        .where(eq(bookingReminders.id, reminder.id));
    } catch (error) {
      // A suppressed address is a *skip* with a reason an owner can act on,
      // not a failure to retry — the whole point of suppression is that
      // trying again is the wrong move.
      const message = error instanceof Error ? error.message : "Sending failed.";
      if (/suppress/i.test(message)) {
        await skip(message);
        continue;
      }
      failed += 1;
      await db()
        .update(bookingReminders)
        .set({ status: "failed", skipReason: message.slice(0, 500), updatedAt: sql`now()` })
        .where(eq(bookingReminders.id, reminder.id));
    }
  }

  return { sent, skipped, failed };
}

export default [listBookingReminders, addBookingReminder, cancelBookingReminder];
