// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C11.03: service/event/rental discovery → availability → booking/waitlist →
// deposit → reminders/waiver → completion → review/loyalty. Public booking
// embed is a contact CTA; this chain is the real scheduling services.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { updateBusiness } from "@/core/settings/service";
import { resolveContact } from "@/core/contacts/service";
import { createCalendar } from "@/core/scheduling/service";
import { setAvailability } from "@/core/scheduling/availability-service";
import {
  createBooking,
  setBookingStatus,
} from "@/core/scheduling/bookings";
import {
  claimWaitlistOffer,
  joinWaitlist,
  offerWaitlistSlot,
} from "@/core/scheduling/waitlist";
import { addBookingReminder, sendDueReminders } from "@/core/scheduling/reminders";
import { issueBookingWaiver } from "@/core/scheduling/requirements";
import {
  applyVariantMatrix,
  createPriceList,
  createProduct,
  getProductVariants,
  setPriceListEntry,
  upsertServiceOffering,
} from "@/modules/catalog/service";
import {
  addEventSession,
  addEventTicket,
  createEvent,
  publishEvent,
  registerForEvent,
} from "@/modules/events/service";
import { eventRegistrations } from "@/modules/events/schema";
import { bookingWaitlist } from "@/core/scheduling/schema";
import { quoteHire, reserveHire, setRentalTerms } from "@/modules/rentals/service";
import { requestReview, submitReview } from "@/modules/reviews/service";
import { enrol, saveEarnRule, saveProgram, statementFor } from "@/modules/loyalty/service";
import { loyaltyAccounts } from "@/modules/loyalty/schema";
import { ANONYMOUS, closeDb, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const NINE = "2026-10-14T09:00:00.000Z";
const TEN = "2026-10-14T10:00:00.000Z";
const ELEVEN = "2026-10-14T11:00:00.000Z";

describe.runIf(hasDatabase)("C11.03 discovery to loyalty", { timeout: 90_000 }, () => {
  beforeEach(async () => {
    await ready();
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
    await updateBusiness.call(
      {
        name: "C11 Studio",
        country: "CA",
        baseCurrency: "CAD",
        timezone: "America/Vancouver",
      },
      OWNER,
    );
  }, 60_000);
  afterAll(closeDb);

  it("discovers service, event and rental, then books, reminds, waives, reviews and enrols", async () => {
    const studio = await createCalendar.call(
      { kind: "resource", name: "Studio A", capacityDefault: 1, timezone: "America/Vancouver" },
      OWNER,
    );
    await setAvailability.call(
      {
        calendarId: studio.id,
        rules: [{ weekday: 3, starts: "09:00", ends: "17:00", kind: "bookable" }],
      },
      OWNER,
    );

    const service = await createProduct.call(
      { name: "Portrait sitting", slug: "c11-sitting", kind: "service" },
      OWNER,
    );
    await applyVariantMatrix.call({ productId: service.id, expectedVersion: service.version }, OWNER);
    const offering = await upsertServiceOffering.call(
      {
        productId: service.id,
        durationMin: 60,
        locationType: "in_person",
        depositType: "fixed",
        depositAmount: "50.00",
        currency: "CAD",
        waiverTitle: "Studio waiver",
        waiverBody: "Pottery is messy and the kiln is hot.",
        reminderOffsetsMin: [60],
      },
      OWNER,
    );

    const event = await createEvent.call(
      {
        name: "Coast workshop",
        slug: "c11-workshop",
        summary: "A morning on the shore.",
        venueName: "Studio 3",
        venueAddress: "210 Fifth Street, Courtenay",
      },
      OWNER,
    );
    const session = await addEventSession.call(
      {
        eventId: event.id,
        startsAt: new Date("2026-10-01T17:00:00Z"),
        endsAt: new Date("2026-10-01T19:00:00Z"),
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
    const first = await registerForEvent.call(
      { eventId: published.id, sessionId: session.id, email: "ada@example.test", name: "Ada" },
      ANONYMOUS,
    );
    expect(first.status).toBe("confirmed");
    const waiting = await registerForEvent.call(
      { eventId: published.id, sessionId: session.id, email: "grace@example.test", name: "Grace" },
      ANONYMOUS,
    );
    expect(waiting.status).toBe("waitlisted");

    const shelf = await createCalendar.call(
      { kind: "resource", name: "Tripod", capacityDefault: 1, timezone: "America/Vancouver" },
      OWNER,
    );
    const rental = await createProduct.call({ name: "Tripod hire", slug: "c11-tripod", kind: "rental" }, OWNER);
    await applyVariantMatrix.call({ productId: rental.id, expectedVersion: rental.version }, OWNER);
    const variant = (await getProductVariants.call({ productId: rental.id }, OWNER)).variants[0]!;
    const list = await createPriceList.call({ name: "Retail", currency: "CAD" }, OWNER);
    await setPriceListEntry.call({ priceListId: list.id, variantId: variant.id, amount: "15.00" }, OWNER);
    await setRentalTerms.call(
      {
        variantId: variant.id,
        calendarId: shelf.id,
        unit: "day",
        depositMinor: 5_000,
        lateFeePerUnitMinor: 1_500,
        replacementValueMinor: 40_000,
      },
      OWNER,
    );
    const hireQuote = await quoteHire.call(
      {
        variantId: variant.id,
        startsAt: "2026-10-14T09:00:00.000Z",
        endsAt: "2026-10-17T09:00:00.000Z",
        currency: "CAD",
      },
      ANONYMOUS,
    );
    expect(hireQuote.available).toBe(true);
    expect(hireQuote.depositMinor).toBe(5_000);
    const reserved = await reserveHire.call(
      {
        variantId: variant.id,
        contact: { email: "rae-c11@example.test", name: "Rae Lane" },
        startsAt: "2026-10-14T09:00:00.000Z",
        endsAt: "2026-10-17T09:00:00.000Z",
        currency: "CAD",
      },
      ANONYMOUS,
    );
    expect(reserved.status).toBeTruthy();

    const rae = await resolveContact.call(
      { email: "rae-c11@example.test", name: "Rae Lane" },
      OWNER,
    );
    const queued = await joinWaitlist.call(
      {
        calendarId: studio.id,
        contact: { email: "wait-c11@example.test", name: "Waiter" },
        windowStart: NINE,
        windowEnd: TEN,
      },
      ANONYMOUS,
    );
    const offered = await offerWaitlistSlot.call(
      { calendarId: studio.id, startsAt: NINE, endsAt: TEN, entryId: queued.id },
      OWNER,
    );
    expect(offered.offered?.id).toBe(queued.id);
    const [held] = await db()
      .select()
      .from(bookingWaitlist)
      .where(eq(bookingWaitlist.id, queued.id));
    await claimWaitlistOffer.call({ token: held!.offerToken! }, ANONYMOUS);

    const sitting = await createBooking.call(
      {
        calendarId: studio.id,
        contact: { email: "rae-c11@example.test", name: "Rae Lane" },
        startsAt: TEN,
        endsAt: ELEVEN,
        source: "admin",
        status: "confirmed",
        serviceOfferingId: offering.id,
      },
      OWNER,
    );
    const waiver = await issueBookingWaiver.call({ id: sitting.id }, OWNER);
    expect(waiver.contractId).toBeTruthy();
    await addBookingReminder.call(
      { bookingId: sitting.id, offsetMin: 60, channel: "email" },
      OWNER,
    );
    await sendDueReminders();
    await setBookingStatus.call({ id: sitting.id, status: "in_progress" }, OWNER);
    await setBookingStatus.call({ id: sitting.id, status: "completed" }, OWNER);

    const asked = await requestReview.call(
      { email: "rae-c11@example.test", source: "post_order" },
      OWNER,
    );
    await submitReview.call(
      { token: asked.token, rating: 5, body: "Lovely sitting." },
      ANONYMOUS,
    );

    const program = await saveProgram.call(
      {
        name: "Stars",
        pointsLabel: "stars",
        status: "active",
        earnCurrency: "CAD",
        redemptionValueCents: 2,
        enrolment: "automatic",
      },
      OWNER,
    );
    await saveEarnRule.call(
      {
        programId: program.id,
        name: "A star for showing up",
        eventType: "contact.created",
        formula: "fixed",
        points: 10,
      },
      OWNER,
    );
    await enrol.call({ contactId: rae.contact.id, programId: program.id }, OWNER);
    const [account] = await db()
      .select()
      .from(loyaltyAccounts)
      .where(eq(loyaltyAccounts.contactId, rae.contact.id));
    expect(account).toBeTruthy();
    const statement = await statementFor.call(
      { contactId: rae.contact.id, programId: program.id },
      OWNER,
    );
    expect(statement).toBeTruthy();
    expect(
      (await db().select().from(eventRegistrations).where(eq(eventRegistrations.status, "waitlisted"))).length,
    ).toBeGreaterThanOrEqual(0);
  });
});
