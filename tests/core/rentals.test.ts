// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Equipment and space hire (C6.10, MASTER.md §4.2).
//
// The claim this file exists to prove is the architectural one. §4.2: "A
// rental is a bookable *thing* rather than a bookable *person*, so it reuses
// the scheduling engine's resource calendars rather than inventing a second
// availability model."
//
// So the test that matters most is the one where two people try to hire the
// same lens for overlapping days and the *database* refuses — through the
// exclusion constraint C6.04 put on bookings, with no rental-specific check
// anywhere in the path. If that ever starts passing because this module grew
// its own availability logic, the design has quietly changed.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/core/auth/schema";
import { bookings } from "@/core/scheduling/schema";
import { rentalAgreements } from "@/modules/rentals/schema";
import { db } from "@/core/db";
import { ready } from "@/core/runtime";
import { createCalendar } from "@/core/scheduling/service";
import { createProduct } from "@/modules/catalog/service";
import { applyVariantMatrix, getProductVariants } from "@/modules/catalog/variants";
import { createPriceList, setPriceListEntry } from "@/modules/catalog/pricing";
import {
  handOver,
  listHires,
  markOverdue,
  quoteHire,
  reserveHire,
  setRentalTerms,
  takeBack,
  closeHire,
} from "@/modules/rentals/service";
import { quoteRental, returnOutcome, unitsBetween } from "@/modules/rentals/pricing";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const TERMS = {
  unit: "day" as const,
  minUnits: 1,
  maxUnits: 14,
  depositMinor: 5_000,
  damagePolicy: "deposit_only" as const,
  replacementValueMinor: 40_000,
  lateFeePerUnitMinor: 1_500,
};

describe("what a hire costs", () => {
  // A day rate is what somebody pays for having the thing overnight, so
  // twenty-five hours is two days. Rounding down would hire out a fortnight's
  // use for a week's money the first time somebody asked for eight days.
  it("counts a part-used unit as a whole one", () => {
    const from = new Date("2026-09-14T09:00:00.000Z");
    expect(unitsBetween(from, new Date("2026-09-15T09:00:00.000Z"), "day")).toBe(1);
    expect(unitsBetween(from, new Date("2026-09-15T10:00:00.000Z"), "day")).toBe(2);
    expect(unitsBetween(from, new Date("2026-09-21T09:00:00.000Z"), "week")).toBe(1);
    expect(unitsBetween(from, new Date("2026-09-14T09:30:00.000Z"), "hour")).toBe(1);
  });

  it("quotes the hire and the deposit as two figures, and one payment", () => {
    const quote = quoteRental({
      terms: TERMS,
      unitRateMinor: 1_500,
      startsAt: new Date("2026-09-14T09:00:00.000Z"),
      endsAt: new Date("2026-09-17T09:00:00.000Z"),
    });
    expect(quote).toMatchObject({ units: 3, hireMinor: 4_500, depositMinor: 5_000 });
    expect(quote.dueNowMinor).toBe(9_500);
  });

  it("never quotes fewer units than the minimum hire", () => {
    const quote = quoteRental({
      terms: { ...TERMS, minUnits: 3 },
      unitRateMinor: 1_000,
      startsAt: new Date("2026-09-14T09:00:00.000Z"),
      endsAt: new Date("2026-09-15T09:00:00.000Z"),
    });
    expect(quote.units).toBe(3);
  });

  it("charges the late fee by the unit, out of the deposit", () => {
    const outcome = returnOutcome({
      terms: TERMS,
      dueAt: new Date("2026-09-17T09:00:00.000Z"),
      returnedAt: new Date("2026-09-19T09:00:00.000Z"),
      condition: "fine",
    });
    expect(outcome).toMatchObject({ unitsLate: 2, lateFeeMinor: 3_000 });
    // £50 deposit less £30 late: £20 back and nothing owed.
    expect(outcome.depositRefundMinor).toBe(2_000);
    expect(outcome.outstandingMinor).toBe(0);
  });

  // `deposit_only` means exactly that. A business that told its customer the
  // deposit was the remedy must not then send a bill on top of it.
  it("keeps a deposit-only policy to the deposit", () => {
    const outcome = returnOutcome({
      terms: TERMS,
      dueAt: new Date("2026-09-17T09:00:00.000Z"),
      returnedAt: new Date("2026-09-25T09:00:00.000Z"),
      condition: "damaged",
    });
    expect(outcome.depositRefundMinor).toBe(0);
    expect(outcome.outstandingMinor).toBe(0);
  });

  it("charges what a replacement costs when the policy says so", () => {
    const outcome = returnOutcome({
      terms: { ...TERMS, damagePolicy: "replacement" },
      dueAt: new Date("2026-09-17T09:00:00.000Z"),
      returnedAt: new Date("2026-09-17T09:00:00.000Z"),
      condition: "damaged",
    });
    expect(outcome.damageFeeMinor).toBe(40_000);
    // £400 against a £50 deposit: nothing back, £350 to invoice.
    expect(outcome).toMatchObject({ depositRefundMinor: 0, outstandingMinor: 35_000 });
  });

  // Lost is replacement whatever the policy says: there is nothing left to
  // repair and nothing left to inspect.
  it("treats a thing that never came back as a replacement", () => {
    const outcome = returnOutcome({
      terms: TERMS,
      dueAt: new Date("2026-09-17T09:00:00.000Z"),
      returnedAt: new Date("2026-09-17T09:00:00.000Z"),
      condition: "lost",
    });
    expect(outcome.damageFeeMinor).toBe(40_000);
    expect(outcome.outstandingMinor).toBe(35_000);
  });

  it("charges the repair when the policy charges for repairs", () => {
    const outcome = returnOutcome({
      terms: { ...TERMS, damagePolicy: "repair_cost" },
      dueAt: new Date("2026-09-17T09:00:00.000Z"),
      returnedAt: new Date("2026-09-17T09:00:00.000Z"),
      condition: "damaged",
      repairCostMinor: 8_000,
    });
    expect(outcome).toMatchObject({ damageFeeMinor: 8_000, outstandingMinor: 3_000 });
  });
});

describe.runIf(hasDatabase)("hiring things out", { timeout: 90_000 }, () => {
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

  /** A rentable variant, its resource calendar, and a day rate. */
  async function tripod(overrides: Record<string, unknown> = {}) {
    const shelf = await createCalendar.call(
      { kind: "resource", name: "Tripod", capacityDefault: 1, timezone: "Europe/London" },
      OWNER,
    );
    const product = await createProduct.call(
      { name: "Tripod hire", slug: "tripod-hire", kind: "rental" },
      OWNER,
    );
    await applyVariantMatrix.call(
      { productId: product.id, expectedVersion: product.version },
      OWNER,
    );
    const variants = await getProductVariants.call({ productId: product.id }, OWNER);
    const variant = variants.variants[0]!;
    // Priced through the catalogue's own list, because §4.2's price lists and
    // breaks apply to hire exactly as they apply to a sale — there is no
    // rental pricing engine to price it with.
    const list = await createPriceList.call(
      { name: "Retail", currency: "GBP" },
      OWNER,
    );
    await setPriceListEntry.call(
      { priceListId: list.id, variantId: variant.id, amount: "15.00" },
      OWNER,
    );
    const terms = await setRentalTerms.call(
      {
        variantId: variant.id,
        calendarId: shelf.id,
        unit: "day",
        depositMinor: 5_000,
        lateFeePerUnitMinor: 1_500,
        replacementValueMinor: 40_000,
        ...overrides,
      },
      OWNER,
    );
    return { calendarId: shelf.id, variantId: variant.id, terms };
  }

  const FROM = "2026-09-14T09:00:00.000Z";
  const TO = "2026-09-17T09:00:00.000Z";

  async function reserve(variantId: string, email = "rae@example.test", from = FROM, to = TO) {
    return reserveHire.call(
      {
        variantId,
        contact: { email, name: email.split("@")[0] },
        startsAt: from,
        endsAt: to,
        currency: "GBP",
      },
      { kind: "anonymous" },
    );
  }

  it("hires only what the business actually hires out", async () => {
    const product = await createProduct.call(
      { name: "Print", slug: "print", kind: "physical" },
      OWNER,
    );
    await applyVariantMatrix.call(
      { productId: product.id, expectedVersion: product.version },
      OWNER,
    );
    const variants = await getProductVariants.call({ productId: product.id }, OWNER);
    const shelf = await createCalendar.call(
      { kind: "resource", name: "Shelf", capacityDefault: 1, timezone: "Europe/London" },
      OWNER,
    );
    const refused = await failure(
      setRentalTerms.call(
        { variantId: variants.variants[0]!.id, calendarId: shelf.id },
        OWNER,
      ),
    );
    expect(refused.message).toContain("rental products");
  });

  // §4.4: a thing's time is a resource calendar. Pointing hire at a person's
  // diary would hire out the person.
  it("refuses to hang hire off somebody's diary", async () => {
    const product = await createProduct.call(
      { name: "Tripod hire", slug: "tripod-hire", kind: "rental" },
      OWNER,
    );
    await applyVariantMatrix.call(
      { productId: product.id, expectedVersion: product.version },
      OWNER,
    );
    const variants = await getProductVariants.call({ productId: product.id }, OWNER);
    const business = await createCalendar.call(
      { kind: "business", name: "The studio", timezone: "Europe/London" },
      OWNER,
    );
    const refused = await failure(
      setRentalTerms.call(
        { variantId: variants.variants[0]!.id, calendarId: business.id },
        OWNER,
      ),
    );
    expect(refused.message).toContain("resource calendar");
  });

  it("quotes from the catalogue's own price, not a second one", async () => {
    const { variantId } = await tripod();
    const quote = await quoteHire.call(
      { variantId, startsAt: FROM, endsAt: TO, currency: "GBP" },
      { kind: "anonymous" },
    );
    expect(quote).toMatchObject({
      available: true,
      units: 3,
      unitRateMinor: 1_500,
      hireMinor: 4_500,
      depositMinor: 5_000,
      dueNowMinor: 9_500,
    });
  });

  it("refuses a hire longer than the business allows", async () => {
    const { variantId } = await tripod({ maxUnits: 2 });
    const quote = await quoteHire.call(
      { variantId, startsAt: FROM, endsAt: TO, currency: "GBP" },
      { kind: "anonymous" },
    );
    expect(quote.available).toBe(false);
    expect(quote.reason).toContain("at most 2");
  });

  // The claim that matters: no availability model here, and none needed.
  it("lets the database refuse the second hire of the same thing", async () => {
    const { variantId } = await tripod();
    await reserve(variantId);
    const clash = await failure(
      reserve(variantId, "sam@example.test", "2026-09-16T09:00:00.000Z", "2026-09-19T09:00:00.000Z"),
    );
    // The message is the booking layer's, which is the point: nothing in the
    // rentals module checked anything about time.
    expect(clash.message).toMatch(/taken/i);

    const held = await db().select({ id: bookings.id }).from(bookings);
    expect(held).toHaveLength(1);
  });

  it("holds the turnaround time as well as the hire", async () => {
    const { variantId } = await tripod({ bufferAfterHours: 24 });
    const hire = await reserve(variantId);
    const [held] = await db()
      .select({ startsAt: bookings.startsAt, endsAt: bookings.endsAt })
      .from(bookings)
      .where(eq(bookings.id, hire.bookingId!));
    // The booking runs a day past the hire, so nobody books the tripod while
    // it is still being cleaned.
    expect(held!.endsAt.toISOString()).toBe("2026-09-18T09:00:00.000Z");
    expect(held!.startsAt.toISOString()).toBe(FROM);
  });

  it("resolves the customer into the spine rather than forking it", async () => {
    const { variantId } = await tripod();
    const hire = await reserve(variantId);
    expect(hire.contactId).toBeTruthy();
    expect(hire.status).toBe("reserved");
    expect(hire).toMatchObject({ units: 3, quotedMinor: 4_500, depositMinor: 5_000 });
  });

  it("walks a hire from reserved to closed", async () => {
    const { variantId } = await tripod();
    const hire = await reserve(variantId);

    const out = await handOver.call(
      { id: hire.id, condition: "Legs fine, plate present." },
      OWNER,
    );
    expect(out).toMatchObject({ status: "out" });
    expect(out.pickedUpAt).toBeTruthy();

    const back = await takeBack.call({ id: hire.id, condition: "fine" }, OWNER);
    expect(back).toMatchObject({ status: "returned", returnCondition: "fine" });
    // Back early: the whole deposit goes home.
    expect(back.depositRefundMinor).toBe(5_000);

    const closed = await closeHire.call({ id: hire.id }, OWNER);
    expect(closed.status).toBe("closed");
  });

  it("will not take back something that never went out", async () => {
    const { variantId } = await tripod();
    const hire = await reserve(variantId);
    const refused = await failure(takeBack.call({ id: hire.id }, OWNER));
    expect(refused.message).toContain("nothing to come back");
  });

  it("keeps the late fee out of the deposit, and says what it came to", async () => {
    const { variantId } = await tripod();
    // Due two days and two hours ago. Part of a day late is a day late — the
    // same rounding the hire itself uses — so this is three days at £15.
    const from = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const to = new Date(Date.now() - (2 * 86_400_000 + 2 * 3_600_000)).toISOString();
    const hire = await reserve(variantId, "rae@example.test", from, to);
    await handOver.call({ id: hire.id }, OWNER);

    const back = await takeBack.call({ id: hire.id, condition: "fine" }, OWNER);
    expect(back.lateFeeMinor).toBe(4_500);
    // £50 deposit less £45 late leaves £5, and nothing further is owed.
    expect(back.depositRefundMinor).toBe(500);
  });

  it("puts what has not come back on a list somebody can chase", async () => {
    const { variantId } = await tripod();
    const from = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const to = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const hire = await reserve(variantId, "rae@example.test", from, to);
    await handOver.call({ id: hire.id }, OWNER);

    const swept = await markOverdue.call({}, OWNER);
    expect(swept.overdue).toBe(1);
    const overdue = await listHires.call({ status: "overdue" }, OWNER);
    expect(overdue).toHaveLength(1);
    expect(overdue[0]?.id).toBe(hire.id);
    // The list carries the SKU, so a hire desk reads "TRIPOD-1" rather than a
    // variant id nobody can act on.
    expect(overdue[0]?.sku).toBeTruthy();
  });

  it("forgets what was written about a person and keeps where the tripod went", async () => {
    const { variantId } = await tripod();
    const hire = await reserve(variantId);
    await handOver.call({ id: hire.id, condition: "A note about them." }, OWNER);

    const { contactPrivacySources } = await import("@/core/privacy/service");
    const source = contactPrivacySources().find((one) => one.scope === "contact.rentals");
    expect(source).toBeTruthy();
    await db().transaction((tx) => source!.erase(tx, hire.contactId, { requestId: "t" }));

    const [after] = await db()
      .select()
      .from(rentalAgreements)
      .where(eq(rentalAgreements.id, hire.id));
    // The business's own record of where its equipment went survives.
    expect(after).toMatchObject({ status: "out", conditionOut: null, notes: null });
    expect(after!.quotedMinor).toBe(4_500);
  });
});
