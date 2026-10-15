// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.25: a member offers a service on their own calendar, someone books it
// through the site's booking flow, and the paid booking is the member's payout.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { contacts } from "@/core/contacts/schema";
import { resolveContact } from "@/core/contacts/service";
import { ready } from "@/core/runtime";
import { updateBusiness } from "@/core/settings/service";
import { availableSlots } from "@/core/scheduling/resolver-service";
import { joinSite, updateMembershipRules } from "@/modules/members/service";
import { createListing } from "@/modules/members/listings";
import { savePayoutInstructions, setPayoutAccountStatus } from "@/modules/members/payouts";
import { memberServices, myBookingHours, myServiceBookings, offerBookableService, setMyBookingHours } from "@/modules/members/member-services";
import { onInvoicePaid } from "@/modules/members/member-subscriptions";
import { memberPayouts } from "@/modules/members/schema";
import { bookableServices, bookPublicService, publicBookingQuote } from "@/modules/catalog/public-booking";
import { createPayment, settlePayment } from "@/modules/invoicing/invoice-service";
import { invoices } from "@/modules/invoicing/schema";
import { ANONYMOUS, closeDb, CUSTOMER, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const RAE = CUSTOMER;
const SAM = { ...CUSTOMER, userId: "00000000-0000-4000-8000-0000000000c2" };
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, starts: "09:00", ends: "17:00" }));

describe.runIf(hasDatabase)("member bookable services (C12.25)", () => {
  beforeAll(async () => { await ready(); }, 60_000);
  beforeEach(async () => {
    await truncateSpine();
    await db().insert(users).values([
      { id: OWNER.userId, email: "owner@example.test", role: "owner" },
      { id: RAE.userId, email: "rae@example.test", role: "customer" },
      { id: SAM.userId, email: "sam@example.test", role: "customer" },
    ]);
    await updateBusiness.call({ name: "Bookings proof", country: "CA", baseCurrency: "CAD", timezone: "UTC" }, OWNER);
    for (const [actor, email] of [[RAE, "rae@example.test"], [SAM, "sam@example.test"]] as const) {
      const { contact } = await resolveContact.call({ email, name: email.split("@")[0]! }, OWNER);
      await db().update(contacts).set({ userId: actor.userId }).where(eq(contacts.id, contact.id));
    }
    await joinSite.call({ handle: "rae", displayName: "Rae", meetsMinimumAge: true, isAdult: true }, RAE);
    await joinSite.call({ handle: "sam", displayName: "Sam", meetsMinimumAge: true, isAdult: true }, SAM);
    await updateMembershipRules.call({ marketplaceEnabled: true, listingReview: false, holdDays: 7 }, OWNER);
    await savePayoutInstructions.call({ instructions: "Interac e-transfer" }, RAE);
    await setPayoutAccountStatus.call({ userId: RAE.userId, status: "ready" }, OWNER);
  });
  afterAll(closeDb);

  it("books a member's service on their calendar and owes them the paid booking", async () => {
    const listing = await createListing.call({ title: "Portrait session", kind: "service", price: "80", acceptPolicy: true }, RAE);
    const physical = await createListing.call({ title: "Print", kind: "physical", price: "20", acceptPolicy: true }, RAE);
    expect((await failure(offerBookableService.call({ productId: physical.productId, durationMin: 60, hours: EVERY_DAY }, RAE))).code).toBe("validation");
    expect((await failure(offerBookableService.call({ productId: listing.productId, durationMin: 60, hours: EVERY_DAY }, SAM))).code).toBe("not_found");
    await offerBookableService.call({ productId: listing.productId, durationMin: 60, hours: EVERY_DAY }, RAE);
    expect((await myBookingHours.call({}, RAE)).hours).toHaveLength(7);

    expect((await bookableServices.call({}, ANONYMOUS)).services).toEqual([]);
    const offered = await memberServices.call({ handle: "rae" }, ANONYMOUS);
    expect(offered.services.map((s) => [s.name, s.durationMin])).toEqual([["Portrait session", 60]]);

    const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const quote = await publicBookingQuote.call({ productId: listing.productId, currency: "CAD", mode: "full", seats: 1 }, SAM);
    expect(quote.totalMinor).toBe(8000);
    const [slot] = await availableSlots.call({ productId: listing.productId, serviceOfferingId: quote.offeringId, from: day, to: day, seats: 1, limit: 50 }, SAM);
    expect(slot).toBeTruthy();
    const booked = await bookPublicService.call({
      productId: listing.productId, currency: "CAD", mode: "full", seats: 1, calendarId: slot!.calendarId,
      startsAt: slot!.startsAt.toISOString(), termsHash: quote.termsHash, acceptedTerms: true, requestKey: crypto.randomUUID(),
    }, SAM);
    expect((await myServiceBookings.call({}, RAE)).map((b) => [b.service, b.customer])).toEqual([["Portrait session", "sam"]]);

    const [invoice] = await db().select().from(invoices).where(eq(invoices.id, booked.invoiceId!));
    const payment = await createPayment.call({ invoiceId: invoice!.id, provider: "manual", method: "bank_transfer", amountMinor: invoice!.totalMinor, idempotencyKey: `pay-${crypto.randomUUID()}` }, OWNER);
    await settlePayment.call({ id: payment.id, providerRef: `offline-${crypto.randomUUID()}` }, OWNER);
    await onInvoicePaid({ invoiceId: invoice!.id });
    const [payout] = await db().select().from(memberPayouts).where(eq(memberPayouts.invoiceId, invoice!.id));
    expect(payout).toMatchObject({ sellerId: RAE.userId, grossMinor: 8000, state: "held" });
  });

  it("stops taking bookings when the member cannot be paid, and keeps their hours editable", async () => {
    const listing = await createListing.call({ title: "Lesson", kind: "service", price: "40", acceptPolicy: true }, RAE);
    await offerBookableService.call({ productId: listing.productId, durationMin: 30, hours: EVERY_DAY }, RAE);
    await setMyBookingHours.call({ hours: [{ weekday: 1, starts: "10:00", ends: "12:00" }] }, RAE);
    expect((await myBookingHours.call({}, RAE)).hours).toEqual([{ weekday: 1, starts: "10:00", ends: "12:00" }]);
    expect((await failure(setMyBookingHours.call({ hours: [{ weekday: 1, starts: "12:00", ends: "10:00" }] }, RAE))).code).toBe("validation");

    await setPayoutAccountStatus.call({ userId: RAE.userId, status: "disabled" }, OWNER);
    expect((await memberServices.call({ handle: "rae" }, ANONYMOUS)).services).toEqual([]);
    const quote = await publicBookingQuote.call({ productId: listing.productId, currency: "CAD", mode: "full", seats: 1 }, SAM);
    expect((await failure(bookPublicService.call({
      productId: listing.productId, currency: "CAD", mode: "full", seats: 1, calendarId: crypto.randomUUID(),
      startsAt: new Date(Date.now() + 86_400_000).toISOString(), termsHash: quote.termsHash, acceptedTerms: true, requestKey: crypto.randomUUID(),
    }, SAM))).code).toBe("conflict");
  });
});
