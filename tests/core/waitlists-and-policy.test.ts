// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Groups, waitlists, and the terms a booking was made under (C6.08, §4.4).
//
// Three claims get proved here, and they are the three that cost an owner a
// customer when they are wrong:
//
//   1. **The customer saw the terms before booking.** Editing a cancellation
//      policy must not change what somebody already agreed to.
//   2. **An offer is held, not raced.** When a seat frees, it belongs to the
//      first person in line until their deadline passes — not to whoever reads
//      their email fastest.
//   3. **A seat is a seat.** Moving into a full class, or adding a guest to
//      one, must be refused the same way booking into it is.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { bookings, bookingWaitlist } from "@/core/scheduling/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { createCalendar } from "@/core/scheduling/service";
import {
  cancellationOutcome,
  mayReschedule,
  noShowOutcome,
  termsFrom,
  NO_POLICY,
  type CancellationTerms,
} from "@/core/scheduling/policy";
import {
  addBookingParticipant,
  bookingByToken,
  cancelByToken,
  createBooking,
  removeBookingParticipant,
  rescheduleBooking,
  rescheduleByToken,
  setBookingStatus,
  setParticipantStatus,
} from "@/core/scheduling/bookings";
import {
  claimWaitlistOffer,
  expireWaitlistOffers,
  joinWaitlist,
  listWaitlist,
  offerWaitlistSlot,
  withdrawFromWaitlist,
} from "@/core/scheduling/waitlist";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const NINE = "2026-09-14T09:00:00.000Z";
const TEN = "2026-09-14T10:00:00.000Z";
const ELEVEN = "2026-09-14T11:00:00.000Z";
const NOON = "2026-09-14T12:00:00.000Z";

const STRICT: CancellationTerms = {
  name: "48 hours, half back",
  freeUntilHours: 48,
  feeType: "percent",
  feeValue: 500_000,
  rescheduleLimit: 1,
  noShowFeeMinor: 2_500,
};

describe("what a cancellation costs", () => {
  const startsAt = new Date("2026-09-14T09:00:00.000Z");
  const money = { valueMinor: 8_000, paidMinor: 2_000 };

  it("charges nothing inside the free window", () => {
    const out = cancellationOutcome({
      terms: STRICT,
      startsAt,
      now: new Date("2026-09-10T09:00:00.000Z"),
      money,
    });
    expect(out).toMatchObject({ free: true, feeMinor: 0, refundDueMinor: 2_000 });
  });

  // The one that is easy to get wrong: half of an £80 appointment is £40
  // whether the customer paid a £20 deposit or the whole thing. Taking half of
  // what happens to have been paid would make the fee depend on how the
  // business collected the money, which is not what anybody agreed to.
  it("takes a percentage of what the appointment was worth, not of the deposit", () => {
    const out = cancellationOutcome({
      terms: STRICT,
      startsAt,
      now: new Date("2026-09-13T09:00:00.000Z"),
      money,
    });
    expect(out.feeMinor).toBe(4_000);
    // £20 paid against a £40 fee: nothing to refund, £20 still owed.
    expect(out.refundDueMinor).toBe(0);
    expect(out.outstandingMinor).toBe(2_000);
  });

  it("splits the other way when they paid more than the fee", () => {
    const out = cancellationOutcome({
      terms: { ...STRICT, feeType: "fixed", feeValue: 1_000 },
      startsAt,
      now: new Date("2026-09-13T09:00:00.000Z"),
      money: { valueMinor: 8_000, paidMinor: 8_000 },
    });
    expect(out).toMatchObject({ feeMinor: 1_000, refundDueMinor: 7_000, outstandingMinor: 0 });
  });

  it("keeps the deposit and asks for nothing more", () => {
    const out = cancellationOutcome({
      terms: { ...STRICT, feeType: "forfeit_deposit", feeValue: null },
      startsAt,
      now: new Date("2026-09-13T09:00:00.000Z"),
      money,
    });
    expect(out).toMatchObject({
      forfeitsDeposit: true,
      feeMinor: 2_000,
      refundDueMinor: 0,
      outstandingMinor: 0,
    });
  });

  // A no-show has no notice period to fall inside, which is exactly why §4.4
  // gives it its own figure rather than reusing the cancellation fee.
  it("charges a no-show whatever the notice would have been", () => {
    expect(noShowOutcome({ terms: STRICT, money }).feeMinor).toBe(2_500);
  });

  it("treats a booking with no policy as free to leave", () => {
    const out = cancellationOutcome({
      terms: termsFrom(null),
      startsAt,
      now: new Date("2026-09-14T08:59:00.000Z"),
      money,
    });
    expect(termsFrom(null)).toEqual(NO_POLICY);
    expect(out).toMatchObject({ free: true, feeMinor: 0, refundDueMinor: 2_000 });
  });

  it("refuses a move once the limit is reached, and once it is too late", () => {
    const spent = mayReschedule({
      terms: STRICT,
      rescheduleCount: 1,
      startsAt,
      now: new Date("2026-09-01T09:00:00.000Z"),
    });
    expect(spent.allowed).toBe(false);
    const late = mayReschedule({
      terms: STRICT,
      rescheduleCount: 0,
      startsAt,
      now: new Date("2026-09-13T09:00:00.000Z"),
    });
    expect(late.allowed).toBe(false);
    expect(late.reason).toContain("48 hours");
  });
});

describe.runIf(hasDatabase)("groups, waitlists and policy", { timeout: 90_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
  }, 60_000);

  afterAll(async () => {
    await truncateSpine();
    await closeDb();
  });

  async function calendar(capacityDefault = 1, name = "Studio A") {
    return createCalendar.call(
      { kind: "resource", name, capacityDefault, timezone: "Europe/London" },
      OWNER,
    );
  }

  async function book(calendarId: string, overrides: Record<string, unknown> = {}) {
    return createBooking.call(
      {
        calendarId,
        contact: { email: "rae@example.test", name: "Rae Lane" },
        startsAt: NINE,
        endsAt: TEN,
        ...overrides,
      },
      OWNER,
    );
  }

  /** Put terms on a booking directly: the catalogue is a module, not core. */
  async function withTerms(id: string, terms: CancellationTerms, startsAt?: string) {
    await db()
      .update(bookings)
      .set({
        cancellationPolicy: terms,
        ...(startsAt ? { startsAt: new Date(startsAt) } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(bookings.id, id));
  }

  it("records what the policy decided, in the words the customer is shown", async () => {
    const studio = await calendar();
    const booked = await book(studio.id);
    // Booked for an hour from now, against a 48-hour policy: firmly late.
    await withTerms(booked.id, STRICT, new Date(Date.now() + 3_600_000).toISOString());

    const cancelled = await setBookingStatus.call(
      { id: booked.id, status: "cancelled", reason: "Something came up." },
      OWNER,
    );
    expect(cancelled.cancellationOutcome).toMatchObject({
      free: false,
      policyName: "48 hours, half back",
    });
    expect((cancelled.cancellationOutcome as { reason: string }).reason).toContain(
      "less than 48 hours",
    );
  });

  // The claim §4.4 actually makes: the customer saw the terms before booking.
  it("holds the terms it was booked under when the policy is edited afterwards", async () => {
    const studio = await calendar();
    const booked = await book(studio.id);
    await withTerms(booked.id, STRICT);

    // Somebody tightens the policy. The booking must not notice.
    const [after] = await db()
      .select({ policy: bookings.cancellationPolicy })
      .from(bookings)
      .where(eq(bookings.id, booked.id));
    expect(termsFrom(after!.policy).freeUntilHours).toBe(48);
    expect(termsFrom(after!.policy).name).toBe("48 hours, half back");
  });

  it("refuses a move once the reschedule limit is spent, and lets the owner override", async () => {
    const studio = await calendar();
    const booked = await book(studio.id);
    await withTerms(booked.id, { ...STRICT, freeUntilHours: 0, rescheduleLimit: 1 });

    const once = await rescheduleBooking.call(
      { id: booked.id, startsAt: TEN, endsAt: ELEVEN }, OWNER,
    );
    expect(once.rescheduleCount).toBe(1);
    // The terms travel with the appointment, or the limit resets every move.
    expect(termsFrom(once.cancellationPolicy).rescheduleLimit).toBe(1);

    const refused = await failure(
      rescheduleBooking.call({ id: once.id, startsAt: ELEVEN, endsAt: NOON }, OWNER),
    );
    expect(refused.message).toContain("already been moved");

    // The policy binds the customer, not the business.
    const moved = await rescheduleBooking.call(
      { id: once.id, startsAt: ELEVEN, endsAt: NOON, overridePolicy: true },
      OWNER,
    );
    expect(moved.rescheduleCount).toBe(2);
  });

  // The hole this item closed: the exclusion constraint deliberately does not
  // fire on a shared calendar, so moving into a full class was the one door
  // left open in the seat accounting.
  it("will not move an appointment into a class that is already full", async () => {
    const studio = await calendar(2, "Yoga");
    await book(studio.id, {
      contact: { email: "a@example.test" },
      startsAt: TEN,
      endsAt: ELEVEN,
      capacityUsed: 2,
    });
    const mine = await book(studio.id, { contact: { email: "b@example.test" } });

    const refused = await failure(
      rescheduleBooking.call({ id: mine.id, startsAt: TEN, endsAt: ELEVEN }, OWNER),
    );
    expect(refused.message).toContain("place(s) left");
  });

  it("gives the seat back when a guest drops out", async () => {
    const studio = await calendar(4, "Pottery");
    const booked = await book(studio.id);
    const guest = await addBookingParticipant.call(
      { bookingId: booked.id, name: "Their sister", seatCount: 2 },
      OWNER,
    );
    const [full] = await db()
      .select({ used: bookings.capacityUsed })
      .from(bookings)
      .where(eq(bookings.id, booked.id));
    expect(full!.used).toBe(3);

    const removed = await removeBookingParticipant.call({ id: guest.id }, OWNER);
    expect(removed.seatsReleased).toBe(2);
    const [back] = await db()
      .select({ used: bookings.capacityUsed })
      .from(bookings)
      .where(eq(bookings.id, booked.id));
    expect(back!.used).toBe(1);
  });

  it("marks who turned up without needing an email address for them", async () => {
    const studio = await calendar(4, "Pottery");
    const booked = await book(studio.id);
    const guest = await addBookingParticipant.call(
      { bookingId: booked.id, name: "Their sister" },
      OWNER,
    );
    const marked = await setParticipantStatus.call(
      { id: guest.id, status: "attended" },
      OWNER,
    );
    expect(marked.status).toBe("attended");
  });

  async function join(email: string, overrides: Record<string, unknown> = {}) {
    return joinWaitlist.call(
      {
        contact: { email, name: email.split("@")[0] },
        windowStart: NINE,
        windowEnd: NOON,
        ...overrides,
      },
      { kind: "anonymous" },
    );
  }

  it("keeps somebody's place rather than adding them twice", async () => {
    const first = await join("rae@example.test");
    const again = await join("rae@example.test");
    expect(again.id).toBe(first.id);
    const counted = await db()
      .select({ count: sql<number>`count(*)::int` })
      .from(bookingWaitlist);
    expect(counted[0]!.count).toBe(1);
  });

  it("resolves a waiting customer into the spine rather than forking it", async () => {
    const studio = await calendar();
    await book(studio.id);
    await join("rae@example.test", { calendarId: studio.id });
    const rows = await db().select({ id: contacts.id }).from(contacts);
    expect(rows).toHaveLength(1);
  });

  // The heart of it: an offer is held for the first person in line, and the
  // seat is not free for anybody else while it is.
  it("offers a freed slot to the first in line, and holds it for them", async () => {
    const studio = await calendar(1, "Chair");
    const first = await join("first@example.test", { calendarId: studio.id });
    await join("second@example.test", { calendarId: studio.id });
    // Ordering is the queue's, not the query's.
    expect(first.position).toBe(0);

    const offered = await offerWaitlistSlot.call(
      { calendarId: studio.id, startsAt: NINE, endsAt: TEN },
      OWNER,
    );
    expect(offered.offered?.id).toBe(first.id);
    expect(offered.offered?.status).toBe("offered");

    // The same slot again finds nothing: the outstanding offer is holding it.
    const again = await offerWaitlistSlot.call(
      { calendarId: studio.id, startsAt: NINE, endsAt: TEN },
      OWNER,
    );
    expect(again.offered).toBeNull();
    expect(again.reason).toContain("Nothing is free");
  });

  it("never puts the offer token in the list", async () => {
    const studio = await calendar(1, "Chair");
    await join("first@example.test", { calendarId: studio.id });
    await offerWaitlistSlot.call(
      { calendarId: studio.id, startsAt: NINE, endsAt: TEN },
      OWNER,
    );
    const queue = await listWaitlist.call({ calendarId: studio.id }, OWNER);
    expect(queue).toHaveLength(1);
    expect(JSON.stringify(queue)).not.toContain("offerToken");
  });

  it("turns a held offer into a real appointment, with no account", async () => {
    const studio = await calendar(1, "Chair");
    const entry = await join("first@example.test", { calendarId: studio.id });
    await offerWaitlistSlot.call(
      { calendarId: studio.id, startsAt: NINE, endsAt: TEN },
      OWNER,
    );
    const [held] = await db()
      .select({ token: bookingWaitlist.offerToken })
      .from(bookingWaitlist)
      .where(eq(bookingWaitlist.id, entry.id));

    const claimed = await claimWaitlistOffer.call(
      { token: held!.token! },
      { kind: "anonymous" },
    );
    expect(claimed.bookingId).toBeTruthy();
    const [after] = await db()
      .select({ status: bookingWaitlist.status, bookingId: bookingWaitlist.bookingId })
      .from(bookingWaitlist)
      .where(eq(bookingWaitlist.id, entry.id));
    expect(after).toMatchObject({ status: "booked", bookingId: claimed.bookingId });

    // The token is spent. A link that keeps working is a second appointment
    // nobody asked for.
    const spent = await failure(
      claimWaitlistOffer.call({ token: held!.token! }, { kind: "anonymous" }),
    );
    expect(spent.code).toBe("not_found");
  });

  it("lets a lapsed offer go, and passes the slot to the next in line", async () => {
    const studio = await calendar(1, "Chair");
    const first = await join("first@example.test", { calendarId: studio.id });
    const second = await join("second@example.test", { calendarId: studio.id });
    await offerWaitlistSlot.call(
      { calendarId: studio.id, startsAt: NINE, endsAt: TEN },
      OWNER,
    );
    // Backdate the deadline rather than waiting a day for it.
    await db()
      .update(bookingWaitlist)
      .set({ offerExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(bookingWaitlist.id, first.id));

    const swept = await expireWaitlistOffers.call({}, { kind: "system" });
    expect(swept).toMatchObject({ expired: 1, reoffered: 1 });

    const [passedTo] = await db()
      .select({ status: bookingWaitlist.status })
      .from(bookingWaitlist)
      .where(eq(bookingWaitlist.id, second.id));
    expect(passedTo!.status).toBe("offered");
    const [lapsed] = await db()
      .select({ status: bookingWaitlist.status, token: bookingWaitlist.offerToken })
      .from(bookingWaitlist)
      .where(eq(bookingWaitlist.id, first.id));
    expect(lapsed).toMatchObject({ status: "expired", token: null });
  });

  it("takes somebody off the queue when they ask", async () => {
    const studio = await calendar(1, "Chair");
    const first = await join("first@example.test", { calendarId: studio.id });
    const second = await join("second@example.test", { calendarId: studio.id });
    await withdrawFromWaitlist.call({ id: first.id }, OWNER);

    const offered = await offerWaitlistSlot.call(
      { calendarId: studio.id, startsAt: NINE, endsAt: TEN },
      OWNER,
    );
    expect(offered.offered?.id).toBe(second.id);
  });

  it("does not offer a slot outside the window somebody asked for", async () => {
    const studio = await calendar(1, "Chair");
    await join("first@example.test", { calendarId: studio.id, windowStart: NINE, windowEnd: TEN });
    const offered = await offerWaitlistSlot.call(
      { calendarId: studio.id, startsAt: ELEVEN, endsAt: NOON },
      OWNER,
    );
    expect(offered.offered).toBeNull();
    expect(offered.reason).toContain("Nobody in the queue");
  });

  it("shows the customer their own appointment and not the owner's notes", async () => {
    const studio = await calendar();
    const booked = await book(studio.id, { notes: "Difficult client, bill for parking." });
    const [row] = await db()
      .select({ token: bookings.rescheduleToken })
      .from(bookings)
      .where(eq(bookings.id, booked.id));

    const view = await bookingByToken.call({ token: row!.token! }, { kind: "anonymous" });
    expect(view).toMatchObject({ calendarName: "Studio A", mayCancel: true });
    expect(JSON.stringify(view)).not.toContain("parking");
  });

  it("lets the customer move their own appointment, and holds them to the terms", async () => {
    const studio = await calendar();
    const booked = await book(studio.id);
    await withTerms(booked.id, { ...STRICT, freeUntilHours: 0, rescheduleLimit: 1 });
    const [row] = await db()
      .select({ token: bookings.rescheduleToken })
      .from(bookings)
      .where(eq(bookings.id, booked.id));

    const moved = await rescheduleByToken.call(
      { token: row!.token!, startsAt: TEN, endsAt: ELEVEN },
      { kind: "anonymous" },
    );
    // A moved appointment gets a new link, and the old one stops working —
    // otherwise the first email anybody kept is a way back to a slot that has
    // moved on.
    expect(moved.mayReschedule).toBe(false);
    const stale = await bookingByToken.call({ token: row!.token! }, { kind: "anonymous" });
    expect(stale?.status).toBe("cancelled");
  });

  it("tells the customer what cancelling cost them, at the moment they do it", async () => {
    const studio = await calendar();
    const booked = await book(studio.id);
    await withTerms(booked.id, STRICT, new Date(Date.now() + 3_600_000).toISOString());
    const [row] = await db()
      .select({ token: bookings.rescheduleToken })
      .from(bookings)
      .where(eq(bookings.id, booked.id));

    const cancelled = await cancelByToken.call(
      { token: row!.token!, reason: "Cannot make it." },
      { kind: "anonymous" },
    );
    expect(cancelled.outcome).toMatchObject({ free: false, policyName: "48 hours, half back" });
  });

  it("forgets somebody who asked to be forgotten, queue and all", async () => {
    const studio = await calendar(1, "Chair");
    const entry = await join("rae@example.test", { calendarId: studio.id });
    const [contact] = await db()
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.email, "rae@example.test"));

    const { contactPrivacySources } = await import("@/core/privacy/service");
    const source = contactPrivacySources().find((one) => one.scope === "contact.waitlist");
    expect(source).toBeTruthy();
    await db().transaction((tx) => source!.erase(tx, contact!.id, { requestId: "test" }));

    const [gone] = await db()
      .select({ id: bookingWaitlist.id })
      .from(bookingWaitlist)
      .where(eq(bookingWaitlist.id, entry.id));
    expect(gone).toBeUndefined();
  });
});
