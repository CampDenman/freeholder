// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Events: venue, sessions, seats, tickets, waitlists, ICS, check-in (C6.11).

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { pages } from "@/modules/cms/schema";
import { publishedPaths } from "@/modules/cms/service";
import { updateBusiness } from "@/core/settings/service";
import {
  addEventSession,
  addEventTicket,
  cancelRegistration,
  checkInRegistration,
  createEvent,
  eventCalendar,
  publishEvent,
  registerForEvent,
} from "@/modules/events/service";
import { eventRegistrations } from "@/modules/events/schema";
import { ANONYMOUS, closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("events module", { timeout: 30_000 }, () => {
  beforeEach(async () => {
    await truncateSpine();
    await updateBusiness.call(
      {
        name: "Aurora Coast Photography",
        country: "CA",
        baseCurrency: "CAD",
        timezone: "America/Vancouver",
      },
      OWNER,
    );
  });
  afterAll(closeDb);

  it("publishes a public event page, waitlists overflow, promotes, checks in, and emits ICS", async () => {
    const event = await createEvent.call(
      {
        name: "Coast workshop",
        slug: "coast-workshop",
        summary: "A morning on the shore.",
        venueName: "Studio 3",
        venueAddress: "210 Fifth Street, Courtenay",
      },
      OWNER,
    );
    const session = await addEventSession.call(
      {
        eventId: event.id,
        startsAt: new Date("2026-09-01T17:00:00Z"),
        endsAt: new Date("2026-09-01T19:00:00Z"),
        timezone: "America/Vancouver",
        capacity: 1,
        waitlistEnabled: true,
      },
      OWNER,
    );
    await addEventTicket.call(
      { eventId: event.id, name: "General", priceMinor: 5_000, currency: "CAD" },
      OWNER,
    );
    const published = await publishEvent.call({ id: event.id, expectedVersion: event.version }, OWNER);

    const [page] = await db()
      .select()
      .from(pages)
      .where(and(eq(pages.slug, "events/coast-workshop"), eq(pages.locale, "en")));
    expect(page).toMatchObject({ status: "published", title: "Coast workshop" });
    const paths = await publishedPaths.call({ locale: "en" }, ANONYMOUS);
    expect(paths.map((entry) => entry.slug)).toEqual(expect.arrayContaining(["events", "events/coast-workshop"]));

    const first = await registerForEvent.call(
      {
        eventId: published.id,
        sessionId: session.id,
        email: "ada@example.test",
        name: "Ada",
      },
      ANONYMOUS,
    );
    expect(first.status).toBe("confirmed");
    const waiting = await registerForEvent.call(
      {
        eventId: published.id,
        sessionId: session.id,
        email: "grace@example.test",
        name: "Grace",
      },
      ANONYMOUS,
    );
    expect(waiting.status).toBe("waitlisted");

    await cancelRegistration.call({ id: first.id }, OWNER);
    const [promoted] = await db()
      .select()
      .from(eventRegistrations)
      .where(eq(eventRegistrations.id, waiting.id));
    expect(promoted?.status).toBe("confirmed");

    const checked = await checkInRegistration.call({ id: waiting.id }, OWNER);
    expect(checked.status).toBe("checked_in");

    const ics = await eventCalendar.call({ slug: "coast-workshop" }, ANONYMOUS);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("SUMMARY:Coast workshop");
    expect(ics).toContain("LOCATION:Studio 3\\, 210 Fifth Street\\, Courtenay");
  });
});
