// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Calendars (C6.01, MASTER.md §4.4): the business, its people, and the things
// they use, all one entity — which is what makes "a therapist and a room" a
// query rather than a feature.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { calendars, calendarMemberships } from "@/core/scheduling/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import {
  archiveCalendar,
  createCalendar,
  getCalendar,
  listCalendars,
  serviceCalendars,
  setServiceCalendars,
  updateCalendar,
} from "@/core/scheduling/service";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const STAFF = "00000000-0000-4000-8000-0000000000c6";
const SERVICE = "00000000-0000-4000-8000-0000000000c7";
const OTHER_SERVICE = "00000000-0000-4000-8000-0000000000c8";

describe.runIf(hasDatabase)("calendars", { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await db()
      .insert(users)
      .values([
        { id: OWNER.userId, email: "owner@example.test", role: "owner" },
        { id: STAFF, email: "therapist@example.test", role: "staff" },
      ])
      .onConflictDoNothing();
  }, 60_000);

  afterAll(async () => {
    await truncateSpine();
    await closeDb();
  });

  async function business() {
    return createCalendar.call({ kind: "business", name: "The studio" }, OWNER);
  }

  async function person() {
    return createCalendar.call(
      { kind: "person", name: "Sam", userId: STAFF, timezone: "Europe/Lisbon" },
      OWNER,
    );
  }

  async function room(name = "Studio A") {
    return createCalendar.call({ kind: "resource", name, capacityDefault: 1 }, OWNER);
  }

  it("makes a person, a room and the business the same kind of thing", async () => {
    const [theBusiness, sam, studio] = [await business(), await person(), await room()];
    expect(theBusiness.kind).toBe("business");
    expect(sam).toMatchObject({ kind: "person", userId: STAFF, timezone: "Europe/Lisbon" });
    // A kiln has no login, and a booking names a calendar rather than a user
    // precisely so that stays true.
    expect(studio.userId).toBeNull();

    const listed = await listCalendars.call({}, OWNER);
    // The business first, then people, then the things they use.
    expect(listed.map((calendar) => calendar.kind)).toEqual([
      "business",
      "person",
      "resource",
    ]);
  });

  it("refuses a second business calendar", async () => {
    await business();
    const refused = await failure(
      createCalendar.call({ kind: "business", name: "The other studio" }, OWNER),
    );
    // Two would be two answers to "when is the business open".
    expect(refused.code).toBe("conflict");
    expect(refused.message).toContain("already has a calendar");
  });

  it("insists a person's calendar has a person, and a room does not", async () => {
    expect(
      (await failure(createCalendar.call({ kind: "person", name: "Nobody" }, OWNER))).code,
    ).toBe("validation");
    expect(
      (
        await failure(
          createCalendar.call({ kind: "resource", name: "Studio A", userId: STAFF }, OWNER),
        )
      ).message,
    ).toContain("no login");
  });

  it("takes the business's timezone when a calendar names none, and keeps its own when it does", async () => {
    const studio = await room();
    // A second location in another country is a calendar, and its hours are
    // local to it.
    expect(studio.timezone).toBeTruthy();
    const sam = await person();
    expect(sam.timezone).toBe("Europe/Lisbon");
  });

  it("refuses a timezone and a slug it cannot honour", async () => {
    expect(
      (
        await failure(
          createCalendar.call(
            { kind: "resource", name: "Studio A", timezone: "Mars/Olympus" },
            OWNER,
          ),
        )
      ).code,
    ).toBe("validation");
    await room("Studio A");
    // Slugs reach URLs, so a collision is a conflict rather than a silent
    // second calendar nobody can link to.
    expect((await failure(room("Studio A"))).code).toBe("conflict");
  });

  it("archives rather than deletes, and never archives the business", async () => {
    const studio = await room();
    const archived = await archiveCalendar.call({ id: studio.id }, OWNER);
    expect(archived.status).toBe("archived");
    // The row is still there: a calendar with a year of appointments behind it
    // is a record of what happened.
    expect(await db().select().from(calendars).where(eq(calendars.id, studio.id))).toHaveLength(1);
    // And out of the way of new work.
    expect(await listCalendars.call({}, OWNER)).toHaveLength(0);
    expect(await listCalendars.call({ includeArchived: true }, OWNER)).toHaveLength(1);

    const theBusiness = await business();
    const refused = await failure(archiveCalendar.call({ id: theBusiness.id }, OWNER));
    expect(refused.code).toBe("conflict");

    await archiveCalendar.call({ id: studio.id, archived: false }, OWNER);
    expect((await getCalendar.call({ id: studio.id }, OWNER))?.status).toBe("active");
  });

  it("lets one service draw on a person and a room at once", async () => {
    const sam = await person();
    const studio = await room();
    await setServiceCalendars.call(
      {
        serviceOfferingId: SERVICE,
        members: [
          { calendarId: sam.id, role: "primary", priority: 0, skillLevel: "senior" },
          { calendarId: studio.id, role: "resource", priority: 0 },
        ],
      },
      OWNER,
    );

    const drawn = await serviceCalendars.call({ serviceOfferingId: SERVICE }, OWNER);
    // This is the row that makes "a therapist *and* a room" answerable.
    expect(drawn.map((member) => member.role).sort()).toEqual(["primary", "resource"]);
    expect(drawn.find((member) => member.role === "primary")?.skillLevel).toBe("senior");
  });

  it("replaces a service's calendars rather than merging into them", async () => {
    const sam = await person();
    const studio = await room();
    await setServiceCalendars.call(
      {
        serviceOfferingId: SERVICE,
        members: [
          { calendarId: sam.id, role: "primary", priority: 0 },
          { calendarId: studio.id, role: "resource", priority: 0 },
        ],
      },
      OWNER,
    );
    await setServiceCalendars.call(
      { serviceOfferingId: SERVICE, members: [{ calendarId: sam.id, role: "primary", priority: 0 }] },
      OWNER,
    );

    // A membership that survived a removal would be a room still being booked
    // after somebody took it out.
    const drawn = await serviceCalendars.call({ serviceOfferingId: SERVICE }, OWNER);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.calendarId).toBe(sam.id);
  });

  it("keeps one service's calendars out of another's", async () => {
    const sam = await person();
    const studio = await room();
    await setServiceCalendars.call(
      { serviceOfferingId: SERVICE, members: [{ calendarId: sam.id, role: "primary", priority: 0 }] },
      OWNER,
    );
    await setServiceCalendars.call(
      {
        serviceOfferingId: OTHER_SERVICE,
        members: [{ calendarId: studio.id, role: "resource", priority: 0 }],
      },
      OWNER,
    );
    expect(await serviceCalendars.call({ serviceOfferingId: SERVICE }, OWNER)).toHaveLength(1);
    expect(await db().select().from(calendarMemberships)).toHaveLength(2);
  });

  it("refuses the same calendar twice in one service, and an archived one at all", async () => {
    const sam = await person();
    const twice = await failure(
      setServiceCalendars.call(
        {
          serviceOfferingId: SERVICE,
          members: [
            { calendarId: sam.id, role: "primary", priority: 0 },
            { calendarId: sam.id, role: "assistant", priority: 1 },
          ],
        },
        OWNER,
      ),
    );
    expect(twice.code).toBe("validation");

    const studio = await room();
    await archiveCalendar.call({ id: studio.id }, OWNER);
    const stale = await failure(
      setServiceCalendars.call(
        {
          serviceOfferingId: SERVICE,
          members: [{ calendarId: studio.id, role: "resource", priority: 0 }],
        },
        OWNER,
      ),
    );
    expect(stale.code).toBe("conflict");
    // Nothing was written on the way to the refusal.
    expect(await db().select().from(calendarMemberships)).toHaveLength(0);
  });

  it("carries the horizon, notice and daily ceiling a resolver will need", async () => {
    const sam = await person();
    const updated = await updateCalendar.call(
      { id: sam.id, bookingHorizonDays: 30, minNoticeMin: 240, maxPerDay: 6 },
      OWNER,
    );
    // Burnout is a scheduling bug, so the ceiling is a column rather than a
    // convention.
    expect(updated).toMatchObject({
      bookingHorizonDays: 30,
      minNoticeMin: 240,
      maxPerDay: 6,
    });
    expect(
      (await failure(updateCalendar.call({ id: sam.id, bookingHorizonDays: 0 }, OWNER))).code,
    ).toBe("validation");
  });

  it("is not something an API key gets to reshape", async () => {
    const refused = await failure(
      createCalendar.call(
        { kind: "resource", name: "Studio A" },
        { kind: "agent", keyName: "bot", scopes: ["*"] },
      ),
    );
    expect(refused.code).toBe("permission");
  });
});
