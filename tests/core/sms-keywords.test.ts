// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Owner SMS keywords: protected vocabulary, idempotent actions, and booking confirmation (C7.14).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { db } from "@/core/db";
import { keywordRuleEvents, messages } from "@/core/messaging/schema";
import {
  createKeywordRule,
  listKeywordRuleEvents,
} from "@/core/messaging/keywords";
import { applySmsEvents } from "@/core/messaging/sms";
import { bookings, calendars } from "@/core/scheduling/schema";
import { ready } from "@/core/runtime";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

describe.runIf(hasDatabase)("SMS keyword actions", { timeout: 90_000 }, () => {
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

  async function contact() {
    const [person] = await db()
      .insert(contacts)
      .values({
        name: "Alex Rivera",
        email: "alex-keyword@example.test",
        phone: "+15005550177",
        preferredLocale: "en-CA",
      })
      .returning();
    return person!;
  }

  it("will not let owner rules shadow mandatory carrier words", async () => {
    const exact = await failure(
      createKeywordRule.call(
        { keyword: "STOP", action: "tag", actionValue: "stopped" },
        OWNER,
      ),
    );
    expect(exact.message).toContain("protected");

    const prefix = await failure(
      createKeywordRule.call(
        { keyword: "ST", match: "prefix", action: "tag", actionValue: "stopped" },
        OWNER,
      ),
    );
    expect(prefix.message).toContain("protected");
  });

  it("applies a localized owner keyword once and keeps the inbound message", async () => {
    const person = await contact();
    await createKeywordRule.call(
      { keyword: "VIP", action: "tag", actionValue: "priority", locale: "en" },
      OWNER,
    );
    const event = {
      id: "SM-keyword-tag",
      kind: "received" as const,
      providerRef: "SM-keyword-tag",
      from: person.phone!,
      body: "vip",
      occurredAt: "2026-08-25T18:00:00.000Z",
    };
    await applySmsEvents.call({ events: [event] }, { kind: "system" });
    await applySmsEvents.call({ events: [event] }, { kind: "system" });

    const [updated] = await db().select().from(contacts).where(eq(contacts.id, person.id));
    expect(updated!.tags).toContain("priority");
    expect(updated!.phoneStatus).toBe("valid");
    expect(await db().select().from(messages)).toHaveLength(1);
    expect(await db().select().from(keywordRuleEvents)).toHaveLength(1);
    const events = await listKeywordRuleEvents.call({ contactId: person.id }, OWNER);
    expect(events[0]).toMatchObject({ action: "tag", outcome: "applied" });
  });

  it("confirms only an unambiguous requested booking", async () => {
    const person = await contact();
    const [calendar] = await db()
      .insert(calendars)
      .values({ kind: "business", name: "Studio", slug: "studio", timezone: "UTC" })
      .returning();
    const startsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1_000);
    const [booking] = await db()
      .insert(bookings)
      .values({
        contactId: person.id,
        calendarId: calendar!.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60 * 1_000),
        timezoneAtBooking: "UTC",
        status: "requested",
      })
      .returning();
    await createKeywordRule.call(
      { keyword: "C", action: "booking_confirm", replyBody: "Your booking is confirmed." },
      OWNER,
    );

    await applySmsEvents.call(
      {
        events: [
          {
            id: "SM-confirm",
            kind: "received",
            providerRef: "SM-confirm",
            from: person.phone!,
            body: "C",
            occurredAt: new Date().toISOString(),
          },
        ],
      },
      { kind: "system" },
    );

    const [confirmed] = await db().select().from(bookings).where(eq(bookings.id, booking!.id));
    expect(confirmed!.status).toBe("confirmed");
    const [evidence] = await db().select().from(keywordRuleEvents);
    expect(evidence).toMatchObject({
      action: "booking_confirm",
      outcome: "applied",
      bookingId: booking!.id,
    });
  });
});
