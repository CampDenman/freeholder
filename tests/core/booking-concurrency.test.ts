// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Proving nobody gets double-booked (C6.04, MASTER.md §4.4).
//
// §4.4: "Double-booking is prevented in the database, not in the UI ... Two
// concurrent requests for the last slot must not both succeed, and no amount
// of careful service-layer checking survives two processes."
//
// So these tests do not check that a guard exists. They run real concurrent
// transactions against a real database and count what survived. There are two
// distinct mechanisms, because there are two distinct shapes of calendar:
//
//   - a calendar that holds one thing at once is protected by an **exclusion
//     constraint**, which fires no matter how many processes race;
//   - a shared calendar overlaps by design, so it is protected by a **row
//     lock** that serialises seat-taking on that calendar and nothing else.
//
// A test that only exercised the first would leave the second — the
// check-then-act one, and therefore the easier one to get wrong — unproven.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { bookings } from "@/core/scheduling/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { lostARace } from "@/core/db/errors";
import { createCalendar } from "@/core/scheduling/service";
import { createBooking, rescheduleBooking } from "@/core/scheduling/bookings";
import { closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const NINE = "2026-09-14T09:00:00.000Z";
const TEN = "2026-09-14T10:00:00.000Z";

/** How many of a set of concurrent attempts came back with a booking. */
function settled(results: PromiseSettledResult<unknown>[]) {
  return {
    won: results.filter((result) => result.status === "fulfilled").length,
    lost: results.filter((result) => result.status === "rejected").length,
    reasons: results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => (result.reason as { message?: string }).message ?? ""),
  };
}

describe.runIf(hasDatabase)("nobody gets double-booked", { timeout: 120_000 }, () => {
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

  async function calendar(capacityDefault: number, name = "Studio A") {
    return createCalendar.call(
      { kind: "resource", name, capacityDefault, timezone: "UTC" },
      OWNER,
    );
  }

  function attempt(calendarId: string, who: number, startsAt = NINE, endsAt = TEN) {
    return createBooking.call(
      {
        calendarId,
        contact: { email: `person-${who}@example.test` },
        startsAt,
        endsAt,
      },
      OWNER,
    );
  }

  it("lets exactly one of eight simultaneous attempts take a 1:1 slot", async () => {
    const studio = await calendar(1);
    // Eight, not two: a constraint that only holds for a pair is not a
    // constraint, and the failure mode this guards against is a popular slot.
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) => attempt(studio.id, index)),
    );
    const outcome = settled(results);
    expect(outcome.won).toBe(1);
    expect(outcome.lost).toBe(7);
    expect(await db().select().from(bookings)).toHaveLength(1);
    // Everybody who lost is told something they can act on.
    expect(outcome.reasons.every((reason) => reason.includes("taken"))).toBe(true);
  });

  it("refuses a partial overlap as firmly as an identical one", async () => {
    const studio = await calendar(1);
    const results = await Promise.allSettled([
      attempt(studio.id, 1, NINE, TEN),
      // Starts halfway through the first.
      attempt(studio.id, 2, "2026-09-14T09:30:00.000Z", "2026-09-14T10:30:00.000Z"),
      // Wholly contains it.
      attempt(studio.id, 3, "2026-09-14T08:00:00.000Z", "2026-09-14T11:00:00.000Z"),
      // Wholly inside it.
      attempt(studio.id, 4, "2026-09-14T09:15:00.000Z", "2026-09-14T09:45:00.000Z"),
    ]);
    expect(settled(results).won).toBe(1);
    expect(await db().select().from(bookings)).toHaveLength(1);
  });

  it("serialises two transactions taking seats on the same calendar", async () => {
    // The deterministic half of the shared-capacity proof.
    //
    // A shared calendar is not protected by the exclusion constraint — it
    // overlaps by design — so seat-taking is check-then-act, and the guard is
    // a row lock. A race test alone cannot prove this: the bad interleaving is
    // timing-dependent, and a run that happens not to hit it proves nothing.
    // So this forces the ordering and asserts the lock actually blocks.
    const room = await calendar(3, "Yoga room");
    const order: string[] = [];

    const holding = db().transaction(async (tx) => {
      await tx.execute(
        sql`select id from calendars where id = ${room.id} for update`,
      );
      order.push("first took the lock");
      await new Promise((resolve) => setTimeout(resolve, 400));
      order.push("first finished");
    });
    const waiting = (async () => {
      // Late enough that the first transaction certainly holds the lock.
      await new Promise((resolve) => setTimeout(resolve, 100));
      await db().transaction(async (tx) => {
        await tx.execute(
          sql`select id from calendars where id = ${room.id} for update`,
        );
        order.push("second took the lock");
      });
    })();

    await Promise.all([holding, waiting]);
    // The second waited for the first to commit, which is what makes its seat
    // count see reality rather than a stale snapshot.
    expect(order).toEqual([
      "first took the lock",
      "first finished",
      "second took the lock",
    ]);
  });

  it("lets a shared calendar fill exactly to capacity and no further", async () => {
    const room = await calendar(3, "Yoga room");
    // Six people, three places, all at once. The lock above is what makes this
    // hold under any interleaving; this is the end-to-end shape of it.
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, index) => attempt(room.id, index)),
    );
    const outcome = settled(results);
    expect(outcome.won).toBe(3);
    expect(outcome.lost).toBe(3);

    const held = await db().select().from(bookings);
    expect(held).toHaveLength(3);
    expect(held.reduce((seats, booking) => seats + booking.capacityUsed, 0)).toBe(3);
  });

  it("counts a party of two against the room, not as one place", async () => {
    const room = await calendar(4, "Yoga room");
    const results = await Promise.allSettled([
      createBooking.call(
        {
          calendarId: room.id,
          contact: { email: "rae@example.test" },
          startsAt: NINE,
          endsAt: TEN,
          capacityUsed: 3,
        },
        OWNER,
      ),
      createBooking.call(
        {
          calendarId: room.id,
          contact: { email: "sam@example.test" },
          startsAt: NINE,
          endsAt: TEN,
          capacityUsed: 3,
        },
        OWNER,
      ),
    ]);
    // Three plus three does not fit in four, however close together the two
    // requests arrive.
    expect(settled(results).won).toBe(1);
    expect(
      (await db().select().from(bookings)).reduce(
        (seats, booking) => seats + booking.capacityUsed,
        0,
      ),
    ).toBe(3);
  });

  it("does not make two people booking different calendars wait on each other", async () => {
    const [first, second] = [await calendar(3, "Room one"), await calendar(3, "Room two")];
    // The lock is per calendar, so this is a correctness claim and a
    // performance one: a busy studio must not serialise its whole diary.
    const results = await Promise.allSettled([
      attempt(first.id, 1),
      attempt(second.id, 2),
    ]);
    expect(settled(results).won).toBe(2);
  });

  it("keeps the constraint out of the way of time that was given back", async () => {
    const studio = await calendar(1);
    const booking = await attempt(studio.id, 1);
    // A cancelled booking holds nothing, so the same slot is free again — and
    // concurrent attempts on it still resolve to exactly one winner.
    await db()
      .update(bookings)
      .set({ status: "cancelled", cancellationReason: "Changed their mind." })
      .where(eq(bookings.id, booking.id));

    const results = await Promise.allSettled([
      attempt(studio.id, 2),
      attempt(studio.id, 3),
    ]);
    expect(settled(results).won).toBe(1);
    expect(
      await db()
        .select()
        .from(bookings)
        .where(sql`${bookings.status} <> 'cancelled'`),
    ).toHaveLength(1);
  });

  it("will not let two appointments be moved onto the same slot at once", async () => {
    const studio = await calendar(1);
    const morning = await attempt(studio.id, 1, "2026-09-14T08:00:00.000Z", "2026-09-14T08:30:00.000Z");
    const afternoon = await attempt(studio.id, 2, "2026-09-14T14:00:00.000Z", "2026-09-14T14:30:00.000Z");

    const results = await Promise.allSettled([
      rescheduleBooking.call({ id: morning.id, startsAt: NINE, endsAt: TEN }, OWNER),
      rescheduleBooking.call({ id: afternoon.id, startsAt: NINE, endsAt: TEN }, OWNER),
    ]);
    const outcome = settled(results);
    expect(outcome.won).toBe(1);
    // The one that lost stays exactly where it was, rather than being cancelled
    // on the way to a slot it never got.
    const survivors = await db()
      .select()
      .from(bookings)
      .where(sql`${bookings.status} <> 'cancelled'`);
    expect(survivors).toHaveLength(2);
    expect(
      survivors.some((booking) => booking.startsAt.toISOString() === NINE),
    ).toBe(true);
  });

  it("says the same thing however Postgres refuses the race", () => {
    // Which of these arrives depends on timing rather than on anything the
    // person did. Translating only the exclusion constraint gives a friendly
    // sentence most of the time and a page of SQL the rest of it — and CI
    // found exactly that, having passed locally five runs out of five.
    for (const code of ["23P01", "40001", "40P01"]) {
      expect(lostARace({ code }), `${code} is losing a race`).toBe(true);
      // Through drizzle's wrapper, which is where it actually arrives.
      expect(lostARace({ message: "Failed query", cause: { code } })).toBe(true);
    }
    // Everything else still reaches the caller as itself.
    for (const other of [{ code: "23505" }, { code: "23502" }, {}, null]) {
      expect(lostARace(other)).toBe(false);
    }
  });

  it("has the exclusion constraint the database is meant to be carrying", async () => {
    // The guarantee is a database object, so the test asserts the database
    // object. A service-layer check that happened to pass every race above
    // would still be the wrong implementation.
    const [found] = (await db().execute(
      sql`select conname, pg_get_constraintdef(oid) as definition
          from pg_constraint where conname = 'bookings_no_overlap'`,
    )) as unknown as { conname: string; definition: string }[];
    expect(found?.conname).toBe("bookings_no_overlap");
    expect(found?.definition).toContain("EXCLUDE USING gist");
    expect(found?.definition).toContain("tstzrange");
    // Scoped, so a class calendar and a finished appointment are out of it.
    expect(found?.definition).toContain("WHERE");
  });
});
