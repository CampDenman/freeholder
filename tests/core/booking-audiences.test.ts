// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Booking audiences (C6.05, MASTER.md §41).
//
// §41 gives one example that decides whether this works: an owner wants
// customers to book them during shop hours, their friends to book them any
// time, and their dentist appointment to block both without telling anybody it
// is a dentist appointment. The first test is that sentence.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { bookingAudiences } from "@/core/scheduling/audience-schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { createCalendar, setServiceCalendars } from "@/core/scheduling/service";
import { setAvailability } from "@/core/scheduling/availability-service";
import { createBooking } from "@/core/scheduling/bookings";
import { resolveSlots } from "@/core/scheduling/resolver";
import {
  audienceFor,
  audienceMayBook,
  createAudience,
  listAudiences,
  rotateAudienceLink,
  audienceLink,
  setAudienceCalendars,
  setAudienceHours,
  setAudienceServices,
} from "@/core/scheduling/audiences";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const SERVICE = "00000000-0000-4000-8000-0000000000f0";
const OTHER_SERVICE = "00000000-0000-4000-8000-0000000000f1";
// 2026-09-13 is a Sunday; 2026-09-14 a Monday.
const SUNDAY = "2026-09-13";
const MONDAY = "2026-09-14";
const NOW = new Date("2026-09-01T00:00:00.000Z");

/** Owner-side actor with a step-up already satisfied, for the link services. */
const STEPPED_UP = {
  ...OWNER,
  security: {
    twoFactorRequired: false,
    twoFactorEnrolled: false,
    twoFactorVerified: false,
    stepUpValid: true,
  },
};

describe.runIf(hasDatabase)("booking audiences", { timeout: 60_000 }, () => {
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

  /** A calendar that works Mondays, nine to five, on one service. */
  async function shop() {
    const calendar = await createCalendar.call(
      { kind: "resource", name: "The chair", timezone: "UTC" },
      OWNER,
    );
    await setAvailability.call(
      {
        calendarId: calendar.id,
        rules: [{ weekday: 1, starts: "09:00", ends: "17:00", kind: "bookable" }],
      },
      OWNER,
    );
    await setServiceCalendars.call(
      {
        serviceOfferingId: SERVICE,
        members: [{ calendarId: calendar.id, role: "primary", priority: 0 }],
      },
      OWNER,
    );
    return calendar;
  }

  async function slotsFor(
    audience: Awaited<ReturnType<typeof audienceFor>>,
    range: { from: string; to: string },
  ) {
    return db().transaction((tx) =>
      resolveSlots(tx, {
        serviceOfferingId: SERVICE,
        from: range.from,
        to: range.to,
        timezone: "UTC",
        durationMin: 60,
        granularityMin: 60,
        now: NOW,
        audienceHours:
          audience?.hours === "custom"
            ? { mode: "custom", rules: audience.customHours }
            : { mode: audience?.hours ?? "calendar" },
        noticeOverrideMin: audience?.minNoticeMin ?? undefined,
        horizonOverrideDays: audience?.bookingHorizonDays ?? undefined,
      }),
    );
  }

  it("lets customers book in shop hours and friends book any time, with the same busy time blocking both", async () => {
    // §41's own example, end to end.
    const calendar = await shop();

    const customers = await createAudience.call(
      { name: "Customers", who: "public", hours: "calendar", position: 10 },
      OWNER,
    );
    const friends = await createAudience.call(
      { name: "Friends and family", who: "token", hours: "any", position: 0 },
      OWNER,
    );
    for (const audience of [customers, friends]) {
      await setAudienceServices.call(
        { id: audience.id, serviceOfferingIds: [SERVICE] },
        OWNER,
      );
      await setAudienceCalendars.call({ id: audience.id, calendarIds: [calendar.id] }, OWNER);
    }

    // The dentist: a real appointment on the same calendar, on the Monday.
    await createBooking.call(
      {
        calendarId: calendar.id,
        contact: { email: "dentist@example.test" },
        startsAt: `${MONDAY}T11:00:00.000Z`,
        endsAt: `${MONDAY}T12:00:00.000Z`,
      },
      OWNER,
    );

    const { token } = await audienceLink.call({ id: friends.id }, STEPPED_UP);
    const asCustomer = await audienceFor(db(), {});
    const asFriend = await audienceFor(db(), { token });
    expect(asCustomer?.name).toBe("Customers");
    expect(asFriend?.name).toBe("Friends and family");

    const customerSunday = await slotsFor(asCustomer, { from: SUNDAY, to: SUNDAY });
    const friendSunday = await slotsFor(asFriend, { from: SUNDAY, to: SUNDAY });
    // The shop is shut on Sunday; a friend is not bound by shop hours.
    expect(customerSunday).toEqual([]);
    expect(friendSunday.length).toBeGreaterThan(0);

    const customerMonday = await slotsFor(asCustomer, { from: MONDAY, to: MONDAY });
    const friendMonday = await slotsFor(asFriend, { from: MONDAY, to: MONDAY });
    const eleven = (slots: { startsAt: Date }[]) =>
      slots.some((slot) => slot.startsAt.toISOString().includes("T11:00"));
    // Neither can have eleven o'clock, and neither is told why. Busy time
    // unions regardless of audience — that rule is not an hours rule.
    expect(eleven(customerMonday)).toBe(false);
    expect(eleven(friendMonday)).toBe(false);
    expect(JSON.stringify(friendMonday)).not.toContain("dentist");
  });

  it("gives an audience its own notice and horizon", async () => {
    await shop();
    const patient = await createAudience.call(
      { name: "Customers", who: "public", minNoticeMin: 60 * 24 * 30, position: 0 },
      OWNER,
    );
    const resolved = await audienceFor(db(), {});
    expect(resolved?.id).toBe(patient.id);
    // A month's notice from a fixed "now" rules the week out entirely.
    expect(await slotsFor(resolved, { from: MONDAY, to: MONDAY })).toEqual([]);
  });

  it("keeps a service out of an audience that was not given it", async () => {
    await shop();
    const audience = await createAudience.call({ name: "Customers" }, OWNER);
    // No rows means none. The alternative default hands a tokenised link the
    // whole catalogue the first time somebody forgets to fill it in.
    expect(await audienceMayBook(db(), audience.id, SERVICE)).toBe(false);

    await setAudienceServices.call(
      { id: audience.id, serviceOfferingIds: [OTHER_SERVICE] },
      OWNER,
    );
    expect(await audienceMayBook(db(), audience.id, SERVICE)).toBe(false);
    expect(await audienceMayBook(db(), audience.id, OTHER_SERVICE)).toBe(true);
  });

  it("proves a token rather than taking one on trust", async () => {
    await createAudience.call({ name: "Friends", who: "token", position: 0 }, OWNER);
    await createAudience.call({ name: "Customers", who: "public", position: 10 }, OWNER);

    const [friends] = await db().select().from(bookingAudiences);
    const wrong = await audienceFor(db(), { token: "not-the-token" });
    // A bad token falls back to the public audience rather than to the one it
    // looks like it names. Guessing generously is how a tokenised link stops
    // meaning anything.
    expect(wrong?.name).toBe("Customers");
    void friends;
  });

  it("rotates a link so the old one stops working", async () => {
    const friends = await createAudience.call(
      { name: "Friends", who: "token", position: 0 },
      OWNER,
    );
    const first = await audienceLink.call({ id: friends.id }, STEPPED_UP);
    const second = await rotateAudienceLink.call({ id: friends.id }, STEPPED_UP);
    expect(second.token).not.toBe(first.token);
    expect((await audienceFor(db(), { token: first.token }))?.id).not.toBe(friends.id);
    expect((await audienceFor(db(), { token: second.token }))?.id).toBe(friends.id);
  });

  it("never lists the token beside everything else", async () => {
    await createAudience.call({ name: "Friends", who: "token" }, OWNER);
    const listed = await listAudiences.call({}, OWNER);
    // A credential is handed over once, deliberately — not scattered through
    // a list an admin screen logs.
    expect(listed[0]).toMatchObject({ hasToken: true });
    expect(JSON.stringify(listed)).not.toContain(
      (await db().select().from(bookingAudiences))[0]!.token!,
    );
  });

  it("puts somebody in the audience the owner ordered first", async () => {
    const contactId = "00000000-0000-4000-8000-0000000000f2";
    await db().insert(contacts).values({
      id: contactId,
      email: "rae@example.test",
      name: "Rae",
      tags: ["vip"],
    });
    await createAudience.call({ name: "Customers", who: "public", position: 10 }, OWNER);
    await createAudience.call(
      { name: "VIPs", who: "tag", contactTag: "vip", position: 0 },
      OWNER,
    );

    // A tagged audience is proved by a contact identity. Ordered first, so
    // somebody in both is found as a VIP.
    expect((await audienceFor(db(), { contactId }))?.name).toBe("VIPs");
    // Without the contact there is nothing to prove it with, and the honest
    // answer is the public audience rather than a guess.
    expect((await audienceFor(db(), {}))?.name).toBe("Customers");
  });

  it("applies an audience's own opening hours", async () => {
    await shop();
    const suppliers = await createAudience.call(
      { name: "Suppliers", who: "public", hours: "custom", position: 0 },
      OWNER,
    );
    await setAudienceHours.call(
      {
        id: suppliers.id,
        hours: "custom",
        // Sunday mornings only, when the shop itself is shut.
        rules: [{ weekday: 0, starts: "07:00", ends: "09:00" }],
      },
      OWNER,
    );
    const resolved = await audienceFor(db(), {});
    const sunday = await slotsFor(resolved, { from: SUNDAY, to: SUNDAY });
    expect(sunday).toHaveLength(2);
    expect(sunday[0]?.startsAt.toISOString()).toBe(`${SUNDAY}T07:00:00.000Z`);
    // And the calendar's own Monday hours no longer apply to them.
    expect(await slotsFor(resolved, { from: MONDAY, to: MONDAY })).toEqual([]);
  });

  it("refuses an audience that could never work", async () => {
    expect(
      (await failure(createAudience.call({ name: "Tagged", who: "tag" }, OWNER))).message,
    ).toContain("needs the tag");
    expect(
      (
        await failure(
          createAudience.call({ name: "Public", who: "public", contactTag: "vip" }, OWNER),
        )
      ).code,
    ).toBe("validation");

    const audience = await createAudience.call({ name: "Suppliers" }, OWNER);
    expect(
      (
        await failure(
          setAudienceHours.call({ id: audience.id, hours: "custom", rules: [] }, OWNER),
        )
      ).message,
    ).toContain("can never book");
  });

  it("takes no bookings at all when nobody has been given an audience", async () => {
    await shop();
    // A legitimate configuration rather than a misconfiguration to paper over:
    // an instance that does not take public bookings.
    expect(await audienceFor(db(), {})).toBeNull();
  });

  it("leaves appointments alone when an audience is removed", async () => {
    const calendar = await shop();
    const audience = await createAudience.call({ name: "Customers" }, OWNER);
    await setAudienceCalendars.call({ id: audience.id, calendarIds: [calendar.id] }, OWNER);
    await createBooking.call(
      {
        calendarId: calendar.id,
        contact: { email: "rae@example.test" },
        startsAt: `${MONDAY}T09:00:00.000Z`,
        endsAt: `${MONDAY}T10:00:00.000Z`,
      },
      OWNER,
    );

    const { removeAudience } = await import("@/core/scheduling/audiences");
    await removeAudience.call({ id: audience.id }, OWNER);
    // An appointment is in somebody's diary. It is not a consequence of the
    // audience still existing.
    const { bookings } = await import("@/core/scheduling/schema");
    expect(await db().select().from(bookings)).toHaveLength(1);
    expect(
      await db().select().from(bookingAudiences).where(eq(bookingAudiences.id, audience.id)),
    ).toHaveLength(0);
  });

  it("is not something an API key configures", async () => {
    const key = { kind: "agent" as const, keyName: "an assistant", scopes: ["audiences.*"] };
    expect((await failure(createAudience.call({ name: "Anyone" }, key))).code).toBe(
      "permission",
    );
  });
});
