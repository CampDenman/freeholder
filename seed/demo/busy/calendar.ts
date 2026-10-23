// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The studio's diary: six months of sittings, the next six weeks booked,
// a waitlist for the Saturdays everyone wants, and the events — past ones
// with check-ins, upcoming ones with seats sold (C1.38 busy demo).
//
// Written as rows rather than service calls, so it holds itself to what the
// services would have refused:
//
//   - no two holding bookings overlap on one calendar (`bookings_no_overlap`),
//     and this seed goes further — no overlap at all, cancelled or not, so the
//     week view never draws two sittings on top of each other;
//   - a booking that has ended is history (completed, no-show, cancelled) and
//     one that has not started is requested or confirmed — nothing is
//     "completed" in the future or "requested" last spring;
//   - every status change the services would have written to the contact's
//     timeline is on it, in order, never after `now`;
//   - a session never holds more occupying seats than its capacity, and a
//     paid seat is confirmed or checked in only behind a paid invoice with a
//     succeeded payment — the same rule `events.checkIn` enforces.
import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/core/service";
import { timelineEvents } from "@/core/contacts/schema";
import { businessLocations } from "@/core/locations/schema";
import {
  bookingReminders,
  bookingWaitlist,
  bookings,
  calendarMemberships,
  calendars,
} from "@/core/scheduling/schema";
import { products, serviceOfferings } from "@/modules/catalog/schema";
import {
  eventRegistrations,
  eventSessions,
  eventTickets,
  events,
} from "@/modules/events/schema";
import {
  invoiceLines,
  invoiceSequences,
  invoices,
  moneyStateEvents,
  payments,
} from "@/modules/invoicing/schema";
import { DAY, HOUR, studioParts, type AreaSeeder, type Person, type World } from "./world";

const MINUTE = 60_000;
const TZ = "America/Vancouver";

/** The bookable services and how often each is booked. */
const SERVICES = [
  { slug: "portrait-session", fallbackMin: 90, weight: 0.45, note: "Family portraits on the beach" },
  { slug: "mini-session", fallbackMin: 30, weight: 0.35, note: "Mini session, two outfits" },
  { slug: "headshot-session", fallbackMin: 45, weight: 0.2, note: "Headshots for a new website" },
] as const;

/** Studio wall-clock hours (Pacific): weekday → [open, close], Sunday closed. */
const OPEN: Record<number, [number, number] | null> = {
  0: null,
  1: [9, 17],
  2: [9, 17],
  3: [9, 17],
  4: [9, 17],
  5: [9, 16],
  6: [10, 14],
};

const CANCEL_REASONS = [
  "Family illness — will rebook in the spring.",
  "Weather: storm warning on the coast.",
  "Client moved away from the Island.",
  "Double-booked with a school event.",
];

const PAST_EVENTS = [
  {
    slug: "spring-mini-session-day",
    name: "Spring mini-session day",
    summary: "Twenty-minute sittings under the cherry trees, prints ready the same week.",
    daysAgo: 158,
    hour: 10,
    hours: 6,
    capacity: 18,
    priceMinor: 6000,
  },
  {
    slug: "summer-print-walk",
    name: "Summer print walk",
    summary: "An evening walk along the Courtenay riverway, ending at the studio wall.",
    daysAgo: 96,
    hour: 18,
    hours: 2,
    capacity: 30,
    priceMinor: 0,
  },
  {
    slug: "golden-hour-on-goose-spit",
    name: "Golden hour on Goose Spit",
    summary: "A small-group shooting workshop at low tide: light, composition, and patience.",
    daysAgo: 61,
    hour: 18,
    hours: 3,
    capacity: 10,
    priceMinor: 8500,
  },
  {
    slug: "autumn-open-studio",
    name: "Autumn open studio",
    summary: "Coffee, the new print wall, and a look at how a gallery gets made.",
    daysAgo: 24,
    hour: 11,
    hours: 4,
    capacity: 40,
    priceMinor: 0,
  },
] as const;

/** The past events this layer creates; each still needs its public page. */
export const PAST_EVENT_SLUGS: readonly string[] = PAST_EVENTS.map((event) => event.slug);

const UPCOMING_EVENT_SLUGS = ["open-studio-print-sale", "golden-hour-workshop", "winter-portrait-day"];

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function pacificWeekday(date: Date): number {
  return studioParts(date).weekday;
}

interface Interval {
  start: number;
  end: number;
}

function overlaps(taken: Interval[], start: number, end: number): boolean {
  return taken.some((slot) => start < slot.end && end > slot.start);
}

function actorFor(w: World, staff = true): string {
  return staff ? `user:${w.staffUserId}` : "system";
}

/**
 * Allocate an invoice number the way `allocateNumber` does: lock the
 * sequence row, read, bump. Shares the sequence with the sales seeder, so
 * numbers stay unique and gapless across both.
 */
async function nextInvoiceNumber(tx: Tx): Promise<string> {
  await tx
    .insert(invoiceSequences)
    .values({ key: "invoice", prefix: "INV-", nextValue: 1, padding: 6 })
    .onConflictDoNothing();
  const [sequence] = await tx
    .select()
    .from(invoiceSequences)
    .where(eq(invoiceSequences.key, "invoice"))
    .for("update");
  await tx
    .update(invoiceSequences)
    .set({ nextValue: sequence!.nextValue + 1 })
    .where(eq(invoiceSequences.key, "invoice"));
  return `${sequence!.prefix}${String(sequence!.nextValue).padStart(sequence!.padding, "0")}`;
}

/**
 * A settled admission invoice for a paid seat: issued, paid in full by an
 * offline (manual-adapter) payment, with the money-state trail the services
 * write. Tax is not applicable, exactly as `issueAdmissionInvoice` records it.
 */
async function paidAdmission(
  tx: Tx,
  w: World,
  args: {
    registrationId: string;
    contactId: string;
    eventName: string;
    ticket: { id: string; name: string; priceMinor: number; currency: string };
    quantity: number;
    issuedAt: Date;
    paidAt: Date;
  },
): Promise<string> {
  const total = args.ticket.priceMinor * args.quantity;
  const number = await nextInvoiceNumber(tx);
  const idempotencyKey = `event-registration:${args.registrationId}`;
  const [invoice] = await tx
    .insert(invoices)
    .values({
      contactId: args.contactId,
      number,
      sourceType: "event",
      sourceId: args.registrationId,
      idempotencyKey,
      requestHash: hash(idempotencyKey),
      status: "paid",
      currency: args.ticket.currency,
      subtotalMinor: total,
      discountMinor: 0,
      shippingMinor: 0,
      taxMinor: 0,
      totalMinor: total,
      paidMinor: total,
      refundedMinor: 0,
      memo: "Event admission; tax not applicable.",
      dueAt: new Date(args.issuedAt.getTime() + 30 * MINUTE),
      issuedAt: args.issuedAt,
      paidAt: args.paidAt,
      createdAt: args.issuedAt,
      updatedAt: args.paidAt,
    })
    .returning({ id: invoices.id });
  await tx.insert(invoiceLines).values({
    invoiceId: invoice!.id,
    position: 0,
    sourceType: "event_ticket",
    sourceId: args.ticket.id,
    description: `${args.eventName} — ${args.ticket.name}`,
    quantityMicros: args.quantity * 1_000_000,
    unitAmountMinor: args.ticket.priceMinor,
    subtotalMinor: total,
    discountMinor: 0,
    taxMinor: 0,
    totalMinor: total,
    createdAt: args.issuedAt,
  });
  const paymentKey = `seed-admission:${args.registrationId}`;
  const [payment] = await tx
    .insert(payments)
    .values({
      invoiceId: invoice!.id,
      provider: "manual",
      providerRef: `manual:${paymentKey}`,
      idempotencyKey: paymentKey,
      requestHash: hash(paymentKey),
      status: "succeeded",
      method: w.r.chance(0.6) ? "external_card" : "bank_transfer",
      currency: args.ticket.currency,
      amountMinor: total,
      refundedMinor: 0,
      processedAt: args.paidAt,
      metadata: { evidence: "Sample payment recorded by the demo seed." },
      createdAt: args.paidAt,
      updatedAt: args.paidAt,
    })
    .returning({ id: payments.id });
  await tx.insert(moneyStateEvents).values([
    { subjectType: "invoice", subjectId: invoice!.id, fromState: "draft", toState: "sent", actor: "system", occurredAt: args.issuedAt },
    { subjectType: "invoice", subjectId: invoice!.id, fromState: "sent", toState: "paid", actor: "system", occurredAt: args.paidAt },
    { subjectType: "payment", subjectId: payment!.id, fromState: null, toState: "succeeded", actor: actorFor(w), occurredAt: args.paidAt },
  ]);
  return invoice!.id;
}

export const seedCalendar: AreaSeeder = async (tx, w) => {
  const counts: Record<string, number> = {
    bookings: 0,
    reminders: 0,
    waitlist: 0,
    pastEvents: 0,
    registrations: 0,
    admissionInvoices: 0,
    timeline: 0,
  };
  const now = w.now.getTime();
  const timeline: Array<typeof timelineEvents.$inferInsert> = [];
  const note = (
    contactId: string,
    eventType: string,
    subjectType: string,
    subjectId: string,
    at: Date,
    actor: string,
    payload: object = {},
  ) => {
    if (at.getTime() > now) return;
    timeline.push({ contactId, actor, eventType, subjectType, subjectId, payload, occurredAt: at });
  };

  // Customers book sittings; leads mostly ask about weddings. Repeat clients
  // are drawn twice as often, which is what makes them repeat clients.
  const customers = w.people.filter((p) => p.lifecycle === "customer" || p.lifecycle === "repeat");
  const prospects = w.people.filter((p) => p.lifecycle === "prospect" || p.lifecycle === "lead");
  const weighted: Person[] = [
    ...customers,
    ...customers.filter((p) => p.lifecycle === "repeat"),
  ];
  const contactOf = (person: Person) => w.contactIds.get(person.key);

  /* ------------------------------------------------------------ bookings */

  const offerings = await tx
    .select({
      slug: products.slug,
      id: serviceOfferings.id,
      durationMin: serviceOfferings.durationMin,
      bufferBeforeMin: serviceOfferings.bufferBeforeMin,
      bufferAfterMin: serviceOfferings.bufferAfterMin,
      reminderOffsetsMin: serviceOfferings.reminderOffsetsMin,
    })
    .from(serviceOfferings)
    .innerJoin(products, eq(products.id, serviceOfferings.productId))
    .where(inArray(products.slug, SERVICES.map((s) => s.slug)));
  const activeCalendars = await tx
    .select()
    .from(calendars)
    .where(eq(calendars.status, "active"))
    .orderBy(asc(calendars.createdAt));
  const memberships = offerings.length
    ? await tx
        .select()
        .from(calendarMemberships)
        .where(inArray(calendarMemberships.serviceOfferingId, offerings.map((o) => o.id)))
        .orderBy(asc(calendarMemberships.priority))
    : [];
  const fallbackCalendar =
    activeCalendars.find((c) => c.kind === "person" && c.capacityDefault <= 1) ??
    activeCalendars.find((c) => c.kind !== "resource" && c.capacityDefault <= 1);

  const plans = SERVICES.flatMap((service) => {
    const offering = offerings.find((o) => o.slug === service.slug);
    if (!offering) return [];
    const primary =
      activeCalendars.find((c) =>
        memberships.some(
          (m) => m.serviceOfferingId === offering.id && m.calendarId === c.id && m.role !== "resource",
        ),
      ) ?? fallbackCalendar;
    if (!primary) return [];
    const resources = activeCalendars.filter((c) =>
      memberships.some(
        (m) => m.serviceOfferingId === offering.id && m.calendarId === c.id && m.role === "resource",
      ),
    );
    return [{ service, offering, primary, resources }];
  });

  const [primaryLocation] = await tx
    .select({ id: businessLocations.id })
    .from(businessLocations)
    .where(eq(businessLocations.isPrimary, true))
    .limit(1);

  const busy = new Map<string, Interval[]>();
  const takenOn = (calendarId: string) => {
    let list = busy.get(calendarId);
    if (!list) busy.set(calendarId, (list = []));
    return list;
  };

  type Planned = {
    plan: (typeof plans)[number];
    person: Person;
    startsAt: Date;
    endsAt: Date;
  };

  /** Find a free slot on a given day, or null. Buffers count as busy. */
  const slotOn = (offsetDays: number, plan: (typeof plans)[number]): { startsAt: Date; endsAt: Date } | null => {
    const probe = w.daysAgo(-offsetDays, 12);
    const hours = OPEN[pacificWeekday(probe)];
    if (!hours) return null;
    const duration = plan.offering.durationMin;
    const before = plan.offering.bufferBeforeMin;
    const after = plan.offering.bufferAfterMin;
    const steps: number[] = [];
    for (let minute = hours[0] * 60; minute + duration <= hours[1] * 60; minute += 30) steps.push(minute);
    const start = w.r.int(0, Math.max(0, steps.length - 1));
    for (let i = 0; i < steps.length; i += 1) {
      const minute = steps[(start + i) % steps.length]!;
      const startsAt = new Date(w.daysAgo(-offsetDays, 0).getTime() + minute * MINUTE);
      const endsAt = new Date(startsAt.getTime() + duration * MINUTE);
      // Judge the sitting on the studio's own clock, not on the arithmetic
      // that produced it: midnight-plus-minutes is only wall-clock time on a
      // day without a daylight-saving change.
      const localStart = studioParts(startsAt);
      const localEnd = studioParts(endsAt);
      if (
        localStart.weekday !== pacificWeekday(probe) ||
        localEnd.day !== localStart.day ||
        localStart.hour * 60 + localStart.minute < hours[0] * 60 ||
        localEnd.hour * 60 + localEnd.minute > hours[1] * 60
      ) {
        continue;
      }
      // Nothing straddles the present: it would have to be in progress.
      if (startsAt.getTime() < now && endsAt.getTime() > now - HOUR) continue;
      const lo = startsAt.getTime() - before * MINUTE;
      const hi = endsAt.getTime() + after * MINUTE;
      const calendarsUsed = [plan.primary.id, ...plan.resources.map((c) => c.id)];
      if (calendarsUsed.some((id) => overlaps(takenOn(id), lo, hi))) continue;
      for (const id of calendarsUsed) takenOn(id).push({ start: lo, end: hi });
      return { startsAt, endsAt };
    }
    return null;
  };

  const pickPlan = () => {
    const roll = w.r.next();
    let acc = 0;
    for (const plan of plans) {
      acc += plan.service.weight;
      if (roll < acc) return plan;
    }
    return plans[plans.length - 1]!;
  };

  const planned: Planned[] = [];
  if (plans.length > 0) {
    for (let offset = -180; offset <= 42; offset += 1) {
      const day = w.daysAgo(-offset, 12);
      const expected = 0.42 * w.r.seasonal(day);
      let wanted = (w.r.chance(Math.min(0.95, expected)) ? 1 : 0) + (w.r.chance(expected * 0.25) ? 1 : 0);
      while (wanted-- > 0) {
        const plan = pickPlan();
        const slot = slotOn(offset, plan);
        if (!slot) continue;
        const pool = offset < 0 || w.r.chance(0.6) ? weighted : prospects;
        const person = w.r.pick(pool.length ? pool : w.people);
        planned.push({ plan, person, ...slot });
      }
    }
  }

  const bookingRows: Array<typeof bookings.$inferInsert & { id: string }> = [];
  const reminderRows: Array<typeof bookingReminders.$inferInsert> = [];
  const upcomingConfirmed: Array<{ id: string; calendarId: string; startsAt: Date; endsAt: Date; offeringId: string }> = [];

  for (const item of planned) {
    const contactId = contactOf(item.person);
    if (!contactId) continue;
    const start = item.startsAt.getTime();
    const end = item.endsAt.getTime();
    const past = end <= now;
    const leadDays = w.r.int(3, 35);
    const createdAt = new Date(Math.min(now - 10 * MINUTE, start - leadDays * DAY));
    const source = w.r.chance(0.6) ? "site" : "admin";
    const roll = w.r.next();
    const status: (typeof bookings.$inferInsert)["status"] = past
      ? roll < 0.8
        ? "completed"
        : roll < 0.9
          ? "cancelled"
          : "no_show"
      : roll < 0.7
        ? "confirmed"
        : roll < 0.95
          ? "requested"
          : "cancelled";
    const id = randomUUID();
    const confirmedAt = new Date(
      Math.min(now - MINUTE, start - HOUR, createdAt.getTime() + w.r.int(2, 30) * HOUR),
    );
    // Somewhere between asking and the day itself, and never after now.
    const cancelUpper = Math.min(now - 5 * MINUTE, start - HOUR);
    const cancelledAt = new Date(
      createdAt.getTime() + HOUR + w.r.next() * Math.max(0, cancelUpper - createdAt.getTime() - HOUR),
    );
    const finishedAt = new Date(Math.min(now - MINUTE, end + w.r.int(1, 5) * HOUR));
    const reason = status === "cancelled" ? w.r.pick(CANCEL_REASONS) : null;
    const updatedAt =
      status === "completed" || status === "no_show"
        ? finishedAt
        : status === "cancelled"
          ? cancelledAt
          : status === "confirmed"
            ? new Date(Math.min(now, confirmedAt.getTime()))
            : createdAt;

    // A handful of past sittings were moved once: the original row is the
    // cancelled "Rescheduled." link, and this one points back at it.
    let rescheduledFromId: string | null = null;
    let movedAt: Date | null = null;
    if (past && status === "completed" && w.r.chance(0.07)) {
      const earlier = new Date(start - w.r.int(2, 9) * DAY);
      const earlierEnd = new Date(earlier.getTime() + (end - start));
      const lo = earlier.getTime() - item.plan.offering.bufferBeforeMin * MINUTE;
      const hi = earlierEnd.getTime() + item.plan.offering.bufferAfterMin * MINUTE;
      const hoursThen = OPEN[pacificWeekday(earlier)];
      const local = studioParts(earlier);
      const startHour = local.hour + local.minute / 60;
      const endHour = startHour + (end - start) / HOUR;
      if (
        earlier.getTime() > createdAt.getTime() + DAY &&
        hoursThen &&
        startHour >= hoursThen[0] &&
        endHour <= hoursThen[1] &&
        !overlaps(takenOn(item.plan.primary.id), lo, hi)
      ) {
        takenOn(item.plan.primary.id).push({ start: lo, end: hi });
        rescheduledFromId = randomUUID();
        movedAt = new Date(Math.min(earlier.getTime() - DAY, createdAt.getTime() + 2 * DAY));
        bookingRows.push({
          id: rescheduledFromId,
          contactId,
          serviceOfferingId: item.plan.offering.id,
          calendarId: item.plan.primary.id,
          secondaryCalendarIds: [],
          startsAt: earlier,
          endsAt: earlierEnd,
          timezoneAtBooking: TZ,
          status: "cancelled",
          locationId: primaryLocation?.id ?? null,
          capacityUsed: 1,
          exclusive: true,
          source,
          notes: item.plan.service.note,
          cancellationReason: "Rescheduled.",
          createdAt,
          updatedAt: movedAt,
        });
        note(contactId, "booking.requested", "booking", rescheduledFromId, createdAt, actorFor(w, source === "admin"), { startsAt: earlier.toISOString(), calendarId: item.plan.primary.id });
        note(contactId, "booking.confirmed", "booking", rescheduledFromId, new Date(createdAt.getTime() + 3 * HOUR), actorFor(w));
        note(contactId, "booking.rescheduled", "booking", id, movedAt, actorFor(w), { from: earlier.toISOString(), to: item.startsAt.toISOString(), previousId: rescheduledFromId });
      }
    }

    bookingRows.push({
      id,
      contactId,
      serviceOfferingId: item.plan.offering.id,
      calendarId: item.plan.primary.id,
      secondaryCalendarIds: item.plan.resources.map((c) => c.id),
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      timezoneAtBooking: TZ,
      status,
      locationId: primaryLocation?.id ?? null,
      capacityUsed: 1,
      exclusive: true,
      rescheduledFromId,
      rescheduleCount: rescheduledFromId ? 1 : 0,
      rescheduleToken: status === "requested" || status === "confirmed" ? hash(`reschedule:${id}`).slice(0, 32) : null,
      source,
      notes: item.plan.service.note,
      cancellationReason: reason,
      // A moved appointment is a new row, written when it was moved.
      createdAt: movedAt ?? createdAt,
      updatedAt,
    });

    if (!rescheduledFromId) {
      note(contactId, "booking.requested", "booking", id, createdAt, actorFor(w, source === "admin"), { startsAt: item.startsAt.toISOString(), calendarId: item.plan.primary.id });
      if (status !== "requested" && !(status === "cancelled" && cancelledAt <= confirmedAt)) {
        note(contactId, "booking.confirmed", "booking", id, confirmedAt, actorFor(w));
      }
    }
    if (status === "cancelled") note(contactId, "booking.cancelled", "booking", id, cancelledAt, actorFor(w), { reason });
    if (status === "completed" || status === "no_show") note(contactId, `booking.${status}`, "booking", id, finishedAt, actorFor(w));

    // Reminders: what the confirmation scheduled. Past ones went out (the
    // playground never delivers mail, but these were sent "before" it).
    if (status === "confirmed" || status === "completed" || status === "no_show") {
      for (const offsetMin of item.plan.offering.reminderOffsetsMin ?? []) {
        const sendAt = new Date(start - offsetMin * MINUTE);
        if (sendAt.getTime() <= confirmedAt.getTime()) continue;
        const sent = sendAt.getTime() <= now;
        if (sent && status === "confirmed") continue; // only future reminders are still scheduled
        reminderRows.push({
          bookingId: id,
          channel: "email",
          offsetMin,
          sendAt,
          sentAt: sent ? sendAt : null,
          // Outside the playground a future reminder is recorded but never
          // sent: these are sample people (World.liveReminders).
          status: sent ? "sent" : w.liveReminders ? "scheduled" : "skipped",
          createdAt: confirmedAt,
          updatedAt: sent ? sendAt : confirmedAt,
        });
      }
    }
    if (status === "confirmed") {
      upcomingConfirmed.push({ id, calendarId: item.plan.primary.id, startsAt: item.startsAt, endsAt: item.endsAt, offeringId: item.plan.offering.id });
    }
  }

  // Originals before the rows that point at them is not required (no FK), but
  // inserting chronologically keeps the diary's natural order on disk.
  bookingRows.sort((a, b) => (a.startsAt).getTime() - (b.startsAt).getTime());
  for (let i = 0; i < bookingRows.length; i += 500) {
    await tx.insert(bookings).values(bookingRows.slice(i, i + 500));
  }
  if (reminderRows.length) await tx.insert(bookingReminders).values(reminderRows);
  counts.bookings = bookingRows.length;
  counts.reminders = reminderRows.length;

  /* ------------------------------------------------------------ waitlist */

  if (plans.length > 0) {
    const portrait = plans.find((p) => p.service.slug === "portrait-session") ?? plans[0]!;
    const waiting: Array<typeof bookingWaitlist.$inferInsert> = [];
    // Saturdays in the next five weeks, which is what everyone asks for.
    const saturdays: Date[] = [];
    for (let offset = 1; offset <= 35 && saturdays.length < 3; offset += 1) {
      const day = w.daysAhead(offset, 10);
      if (pacificWeekday(day) === 6) saturdays.push(day);
    }
    let position = 0;
    for (const saturday of saturdays) {
      for (let k = 0; k < 2; k += 1) {
        const person = w.r.pick(weighted.length ? weighted : w.people);
        const contactId = contactOf(person);
        if (!contactId) continue;
        waiting.push({
          contactId,
          serviceOfferingId: portrait.offering.id,
          calendarId: portrait.primary.id,
          windowStart: saturday,
          windowEnd: new Date(saturday.getTime() + 4 * HOUR),
          seatCount: 1,
          status: "waiting",
          position: position++,
          notes: "Any Saturday morning works.",
          createdAt: w.daysAgo(w.r.int(1, 12)),
        });
      }
    }
    // One that lapsed last month, and one that became a real sitting.
    const lapsed = w.r.pick(prospects.length ? prospects : w.people);
    if (contactOf(lapsed)) {
      waiting.push({
        contactId: contactOf(lapsed)!,
        serviceOfferingId: portrait.offering.id,
        calendarId: portrait.primary.id,
        windowStart: w.daysAgo(30, 10),
        windowEnd: w.daysAgo(30, 14),
        status: "expired",
        position: 0,
        createdAt: w.daysAgo(40),
        updatedAt: w.daysAgo(30),
      });
    }
    const claimed = upcomingConfirmed.find((b) => b.offeringId === portrait.offering.id);
    if (claimed) {
      const owner = bookingRows.find((b) => b.id === claimed.id)!;
      waiting.push({
        contactId: owner.contactId,
        serviceOfferingId: portrait.offering.id,
        calendarId: claimed.calendarId,
        windowStart: new Date(claimed.startsAt.getTime() - 2 * HOUR),
        windowEnd: new Date(claimed.endsAt.getTime() + 2 * HOUR),
        status: "booked",
        position: 0,
        bookingId: claimed.id,
        createdAt: new Date((owner.createdAt as Date).getTime() - 2 * DAY),
        updatedAt: owner.createdAt,
      });
    }
    if (waiting.length) await tx.insert(bookingWaitlist).values(waiting);
    counts.waitlist = waiting.length;
  }

  /* -------------------------------------------------------------- events */

  // Past events, created here: published, held, and over. Free ones admit
  // without a ticket; paid ones carry one ticket type.
  const pastEventRows = await tx
    .insert(events)
    .values(
      PAST_EVENTS.map((event) => {
        const created = w.daysAgo(event.daysAgo + 45);
        return {
          name: event.name,
          slug: event.slug,
          summary: event.summary,
          venueLocationId: primaryLocation?.id ?? null,
          venueName: primaryLocation ? null : "Aurora Coast studio",
          status: "published" as const,
          seo: { description: event.summary },
          workingName: event.name,
          workingSummary: event.summary,
          workingSeo: { description: event.summary },
          version: 2,
          publishedAt: w.daysAgo(event.daysAgo + 40),
          createdAt: created,
          updatedAt: w.daysAgo(event.daysAgo - 1),
        };
      }),
    )
    .onConflictDoNothing({ target: events.slug })
    .returning({ id: events.id, slug: events.slug });
  counts.pastEvents = pastEventRows.length;

  type SessionPlan = {
    eventId: string;
    eventName: string;
    session: typeof eventSessions.$inferSelect;
    ticket: { id: string; name: string; priceMinor: number; currency: string } | null;
    past: boolean;
    fill: number;
  };
  const sessionPlans: SessionPlan[] = [];

  for (const row of pastEventRows) {
    const spec = PAST_EVENTS.find((e) => e.slug === row.slug)!;
    const startsAt = w.daysAgo(spec.daysAgo, spec.hour);
    const [session] = await tx
      .insert(eventSessions)
      .values({
        eventId: row.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + spec.hours * HOUR),
        timezone: TZ,
        capacity: spec.capacity,
        waitlistEnabled: true,
        createdAt: w.daysAgo(spec.daysAgo + 45),
      })
      .returning();
    let ticket: SessionPlan["ticket"] = null;
    if (spec.priceMinor > 0) {
      const [created] = await tx
        .insert(eventTickets)
        .values({
          eventId: row.id,
          name: "General admission",
          priceMinor: spec.priceMinor,
          currency: "CAD",
          createdAt: w.daysAgo(spec.daysAgo + 45),
        })
        .returning();
      ticket = { id: created!.id, name: created!.name, priceMinor: created!.priceMinor, currency: created!.currency };
    }
    sessionPlans.push({ eventId: row.id, eventName: spec.name, session: session!, ticket, past: true, fill: 0.7 + w.r.next() * 0.25 });
  }

  // Upcoming events the base demo published: some seats already sold. The
  // base demo publishes them at install; a studio six months in announced
  // them weeks ago, so they are dated back before registrations are spread
  // over that window.
  const announced = w.daysAgo(45);
  const upcomingIds = (
    await tx
      .update(events)
      .set({ createdAt: announced, publishedAt: announced })
      .where(and(inArray(events.slug, UPCOMING_EVENT_SLUGS), eq(events.status, "published")))
      .returning({ id: events.id })
  ).map((row) => row.id);
  if (upcomingIds.length) {
    await tx.update(eventSessions).set({ createdAt: announced }).where(inArray(eventSessions.eventId, upcomingIds));
  }
  const upcoming = await tx
    .select()
    .from(events)
    .where(and(inArray(events.slug, UPCOMING_EVENT_SLUGS), eq(events.status, "published")));
  for (const event of upcoming) {
    const sessions = await tx
      .select()
      .from(eventSessions)
      .where(eq(eventSessions.eventId, event.id))
      .orderBy(asc(eventSessions.startsAt));
    const tickets = await tx
      .select()
      .from(eventTickets)
      .where(and(eq(eventTickets.eventId, event.id), eq(eventTickets.active, true)))
      .orderBy(asc(eventTickets.priceMinor));
    // An event with tickets admits only on one: pick the cheapest active one.
    const ticket = tickets[0]
      ? { id: tickets[0].id, name: tickets[0].name, priceMinor: tickets[0].priceMinor, currency: tickets[0].currency }
      : null;
    for (const session of sessions) {
      if (session.startsAt.getTime() <= now) continue;
      sessionPlans.push({ eventId: event.id, eventName: event.name, session, ticket, past: false, fill: 0.3 + w.r.next() * 0.4 });
    }
  }

  for (const plan of sessionPlans) {
    const { session } = plan;
    // Seats already held on this session (e.g. a demo fixture's) count too.
    const existing = await tx
      .select({ contactId: eventRegistrations.contactId, quantity: eventRegistrations.quantity, status: eventRegistrations.status })
      .from(eventRegistrations)
      .where(eq(eventRegistrations.sessionId, session.id));
    let occupied = existing
      .filter((r) => r.status === "reserved" || r.status === "confirmed" || r.status === "checked_in")
      .reduce((sum, r) => sum + r.quantity, 0);
    const seen = new Set(existing.map((r) => r.contactId));
    const target = Math.floor(session.capacity * plan.fill);
    // Registrations arrive between the sale opening (six weeks out, or when
    // the session was set up if that was earlier) and an hour before it
    // starts — and never after now.
    const lastDay = Math.min(now - HOUR, session.startsAt.getTime() - HOUR);
    const firstDay = Math.min(
      lastDay - HOUR,
      Math.max(session.createdAt.getTime(), session.startsAt.getTime() - 42 * DAY),
    );
    const pool = [...customers, ...prospects];
    let guard = 0;
    while (occupied < target && guard++ < 400 && pool.length) {
      const person = w.r.pick(pool);
      const contactId = contactOf(person);
      if (!contactId || seen.has(contactId)) continue;
      const quantity = w.r.chance(0.2) ? 2 : 1;
      const cancelled = w.r.chance(0.06);
      if (!cancelled && occupied + quantity > session.capacity) break;
      seen.add(contactId);
      const registeredAt = new Date(firstDay + w.r.next() * (lastDay - firstDay));
      const id = randomUUID();
      const attended = plan.past && !cancelled && w.r.chance(0.88);
      const checkedInAt = attended
        ? new Date(session.startsAt.getTime() + w.r.int(-10, 25) * MINUTE)
        : null;
      const status = cancelled ? "cancelled" : attended ? "checked_in" : "confirmed";
      await tx.insert(eventRegistrations).values({
        id,
        eventId: plan.eventId,
        sessionId: session.id,
        ticketId: plan.ticket?.id ?? null,
        contactId,
        status,
        quantity,
        checkedInAt,
        createdAt: registeredAt,
        updatedAt: checkedInAt ?? registeredAt,
      });
      if (plan.ticket && plan.ticket.priceMinor > 0) {
        const paidAt = new Date(Math.min(lastDay, registeredAt.getTime() + w.r.int(2, 25) * MINUTE));
        const invoiceId = await paidAdmission(tx, w, {
          registrationId: id,
          contactId,
          eventName: plan.eventName,
          ticket: plan.ticket,
          quantity,
          issuedAt: registeredAt,
          paidAt: new Date(Math.max(paidAt.getTime(), registeredAt.getTime() + MINUTE)),
        });
        await tx.update(eventRegistrations).set({ invoiceId }).where(eq(eventRegistrations.id, id));
        counts.admissionInvoices! += 1;
      }
      note(contactId, "event.registered", "event_registration", id, registeredAt, "system", { eventId: plan.eventId, sessionId: session.id, quantity });
      if (checkedInAt) note(contactId, "event.checkedIn", "event_registration", id, checkedInAt, actorFor(w), { eventId: plan.eventId });
      if (!cancelled) occupied += quantity;
      counts.registrations! += 1;
    }
  }

  timeline.sort((a, b) => (a.occurredAt as Date).getTime() - (b.occurredAt as Date).getTime());
  for (let i = 0; i < timeline.length; i += 1000) {
    await tx.insert(timelineEvents).values(timeline.slice(i, i + 1000));
  }
  counts.timeline = timeline.length;
  return counts;
};
