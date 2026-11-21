// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { users } from "@/core/auth/schema";
import { createSession } from "@/core/auth/sessions";
import { closeDb, db } from "@/core/db";
import { resetEnvForTests } from "@/core/env";
import { auditLog } from "@/core/events/schema";
import {
  checkFindMeStillBookingLink, getFindMeStillDesk, pinFindMeStillDesk, setFindMeStillDeskGrant,
} from "@/core/findmestill/service";
import { findMeStillDesks, findMeStillDeskGrants } from "@/core/findmestill/schema";
import { actorFromRequest } from "@/core/http/actor";
import { ready } from "@/core/runtime";
import { createBooking } from "@/core/scheduling/bookings";
import { createCalendar } from "@/core/scheduling/service";
import { getService, listExternalServices } from "@/core/service";
import fixture from "../fixtures/findmestill-discovery-v0.1.json";
import { bookingTime } from "../helpers/booking-time";
import { ANONYMOUS, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const identity = fixture.contactId;
const primary = { identity };
const openGrant = { identity, userId: CUSTOMER.userId, grant: { expiresAt: null } };
const pin = (cards: string[]) => pinFindMeStillDesk.call({ identity, documents: [JSON.stringify(cards)] }, OWNER);
const actorWithBusinessAccess = {
  ...CUSTOMER,
  grants: [{ module: "contacts", access: "view" }, { module: "bookings", access: "view" }],
} as const;

async function seedLocalPeople() {
  await db().insert(users).values([
    { id: OWNER.userId, email: "findmestill-owner@example.test", role: "owner" },
    { id: CUSTOMER.userId, email: "findmestill-customer@example.test", role: "customer" },
  ]);
}

async function asSession(token: string) {
  return actorFromRequest(new Request("https://app.example.test/", { headers: { authorization: `Bearer ${token}` } }));
}

describe.runIf(hasDatabase)("FindMeStill local desks", () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await seedLocalPeople();
    vi.spyOn(Date, "now").mockReturnValue(fixture.initialTime * 1_000);
  }, 60_000);
  afterEach(() => vi.restoreAllMocks());
  afterAll(closeDb);

  it("registers the shared services without opening HTTP or MCP access", () => {
    expect(getService(pinFindMeStillDesk.def.name)).toBe(pinFindMeStillDesk);
    expect(getService(checkFindMeStillBookingLink.def.name)).toBe(checkFindMeStillBookingLink);
    expect([...listExternalServices().keys()].some((name) => name.startsWith("findMeStill."))).toBe(false);
  });

  it("persists only the exact signed head and preserves it on stale or conflicting input", async () => {
    expect(await pin(fixture.initial)).toEqual({ identity, revision: 1 });
    vi.mocked(Date.now).mockReturnValue(fixture.movedTime * 1_000);
    expect(await pin(fixture.moved)).toEqual({ identity, revision: 2 });
    expect(await pin(fixture.initial)).toEqual({ identity, revision: 2 });
    expect((await failure(pin(fixture.conflict))).code).toBe("validation");
    expect(await db().select().from(findMeStillDesks)).toEqual([{ identity, compactJws: fixture.moved[1] }]);
    const auditRows = await db().select({ diff: auditLog.diff }).from(auditLog).where(eq(auditLog.action, pinFindMeStillDesk.def.name));
    expect(auditRows).toEqual([{ diff: { identity } }, { diff: { identity } }, { diff: { identity } }]);
  });

  it("admits only one of two concurrently submitted signed forks", async () => {
    await pin(fixture.initial);
    vi.mocked(Date.now).mockReturnValue(fixture.movedTime * 1_000);
    const writes = await Promise.allSettled([pin(fixture.moved), pin(fixture.conflict)]);
    const accepted = writes.findIndex((attempt) => attempt.status === "fulfilled");
    expect(writes.map((attempt) => attempt.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(writes[1 - accepted]).toMatchObject({ status: "rejected", reason: { code: "validation" } });
    const chains = [fixture.moved, fixture.conflict];
    expect(await db().select().from(findMeStillDesks)).toEqual([{ identity, compactJws: chains[accepted]?.[1] }]);
  });

  it("requires a local explicit grant even for staff and refuses revoked or expired grants", async () => {
    await pin(fixture.initial);
    expect((await failure(getFindMeStillDesk.call(primary, OWNER))).code).toBe("not_found");
    expect((await failure(getFindMeStillDesk.call(primary, ANONYMOUS))).code).toBe("permission");
    expect((await failure(setFindMeStillDeskGrant.call(openGrant, actorWithBusinessAccess))).code).toBe("permission");
    expect((await failure(setFindMeStillDeskGrant.call(openGrant, { ...OWNER, security: {
      twoFactorRequired: true, twoFactorEnrolled: true, twoFactorVerified: true, stepUpValid: false,
    } }))).code).toBe("step_up_required");
    expect((await failure(setFindMeStillDeskGrant.call({ ...openGrant, userId: randomUUID() }, OWNER))).code).toBe("not_found");
    await setFindMeStillDeskGrant.call(openGrant, OWNER);
    expect(await getFindMeStillDesk.call(primary, CUSTOMER)).toEqual({ identity, revision: 1 });
    await db().update(findMeStillDeskGrants).set({ expiresAt: sql`now() - interval '1 second'` });
    expect((await failure(getFindMeStillDesk.call(primary, CUSTOMER))).code).toBe("not_found");
    await setFindMeStillDeskGrant.call(openGrant, OWNER);
    await setFindMeStillDeskGrant.call({ ...openGrant, grant: null }, OWNER);
    expect((await failure(getFindMeStillDesk.call(primary, CUSTOMER))).code).toBe("not_found");
  });

  it("keeps desk access, CRM access and booking access independent", async () => {
    await pin(fixture.initial);
    const calendar = await createCalendar.call({ kind: "resource", name: "Bookings desk", timezone: "UTC" }, OWNER);
    const booking = await createBooking.call({ calendarId: calendar.id, contact: { email: "booking@example.test" },
      startsAt: bookingTime(9, 0), endsAt: bookingTime(10, 0) }, OWNER);
    const input = { identity, contactId: booking.contactId, bookingId: booking.id };
    expect((await failure(checkFindMeStillBookingLink.call(input, actorWithBusinessAccess))).code).toBe("not_found");
    await setFindMeStillDeskGrant.call(openGrant, OWNER);
    expect((await failure(checkFindMeStillBookingLink.call(input, CUSTOMER))).code).toBe("permission");
    expect((await failure(checkFindMeStillBookingLink.call(input, {
      ...CUSTOMER, grants: [{ module: "contacts", access: "view" }],
    }))).code).toBe("permission");
    expect(await checkFindMeStillBookingLink.call(input, actorWithBusinessAccess))
      .toEqual({ contactId: booking.contactId, bookingId: booking.id });
    expect((await failure(checkFindMeStillBookingLink.call({ ...input, contactId: randomUUID() }, actorWithBusinessAccess))).code)
      .toBe("not_found");
  });

  // Supply a second explicitly disposable, already migrated installation for this witness.
  const secondSite = process.env.FINDMESTILL_TEST_DATABASE_B_URL;
  it.runIf(Boolean(secondSite))("isolates grants and real login sessions across two installations with identical IDs", async () => {
    const firstSite = process.env.DATABASE_URL!;
    const secondUrl = new URL(secondSite!);
    expect(secondUrl.hostname).toBe("127.0.0.1");
    expect(secondUrl.pathname).toMatch(/^\/freeholder_findmestill_.*_test$/);
    expect(new URL(firstSite).host).not.toBe(secondUrl.host);
    await pin(fixture.initial);
    await setFindMeStillDeskGrant.call(openGrant, OWNER);
    const firstSession = await db().transaction((tx) => createSession(tx, CUSTOMER.userId));
    expect(await getFindMeStillDesk.call(primary, await asSession(firstSession.token))).toEqual({ identity, revision: 1 });

    await closeDb();
    process.env.DATABASE_URL = secondSite;
    resetEnvForTests();
    try {
      await truncateSpine();
      await seedLocalPeople();
      await pin(fixture.initial);
      const secondSession = await db().transaction((tx) => createSession(tx, CUSTOMER.userId));
      expect((await asSession(firstSession.token)).kind).toBe("anonymous");
      const local = await asSession(secondSession.token);
      expect(local).toMatchObject({ kind: "user", userId: CUSTOMER.userId });
      expect((await failure(getFindMeStillDesk.call(primary, local))).code).toBe("not_found");
      await setFindMeStillDeskGrant.call(openGrant, OWNER);
      expect(await getFindMeStillDesk.call(primary, local)).toEqual({ identity, revision: 1 });
      await setFindMeStillDeskGrant.call({ ...openGrant, grant: null }, OWNER);
    } finally {
      await closeDb();
      process.env.DATABASE_URL = firstSite;
      resetEnvForTests();
    }
    expect(await getFindMeStillDesk.call(primary, await asSession(firstSession.token))).toEqual({ identity, revision: 1 });
  }, 90_000);
});
