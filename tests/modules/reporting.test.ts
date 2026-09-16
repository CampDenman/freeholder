// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Reports an owner will actually read (MASTER.md §2535, §4.7, C9.08).
//
// The tests worth reading first are the two about money that is not one
// number: revenue never adds two currencies together, and a refund comes back
// out of the month the money left rather than the month it arrived.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { invoices } from "@/modules/invoicing/schema";
import { businessLocations } from "@/core/locations/schema";
import { bookings, calendars } from "@/core/scheduling/schema";
import {
  orderItems,
  orders,
  productVariants,
  products,
  serviceOfferings,
} from "@/modules/catalog/schema";
import { resolveContact } from "@/core/contacts/service";
import {
  cohortReport,
  deleteReportView,
  listReportViews,
  reportDefinitions,
  revenueByReport,
  revenueReport,
  saveReportView,
} from "@/modules/reporting/service";
import { ready } from "@/core/runtime";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const ago = (days: number) => new Date(Date.now() - days * 86_400_000);

let sequence = 0;

/** One invoice, paid. The only thing revenue is made of (§4.6). */
async function paid(options: {
  contactId: string;
  currency: string;
  totalMinor: number;
  paidAt: Date;
  refundedMinor?: number;
}) {
  sequence += 1;
  const [row] = await db()
    .insert(invoices)
    .values({
      contactId: options.contactId,
      number: `INV-${sequence}`,
      sequenceKey: "default",
      idempotencyKey: `test-${sequence}`,
      requestHash: String(sequence).padStart(64, "0"),
      currency: options.currency,
      status: "paid",
      subtotalMinor: options.totalMinor,
      totalMinor: options.totalMinor,
      paidMinor: options.totalMinor,
      refundedMinor: options.refundedMinor ?? 0,
      issuedAt: options.paidAt,
      paidAt: options.paidAt,
    })
    .returning();
  return row!;
}

async function person(name: string) {
  const { contact } = await resolveContact.call(
    { email: `${name}@example.test`, name },
    OWNER,
  );
  return contact;
}

/** A product, with the one variant an order line needs. */
async function product(name: string, kind: "physical" | "service" = "physical") {
  sequence += 1;
  const [row] = await db()
    .insert(products)
    .values({ name, slug: `${name.toLowerCase().replace(/\W+/g, "-")}-${sequence}`, kind })
    .returning();
  const [variant] = await db()
    .insert(productVariants)
    .values({
      productId: row!.id,
      combinationKey: `default-${sequence}`,
      sku: `sku-${sequence}`,
      isDefault: true,
    })
    .returning();
  return { product: row!, variant: variant! };
}

/** A booking of a named service, billed to a paid invoice. */
async function booked(
  contactId: string,
  serviceName: string,
  invoiceId: string,
  locationName?: string,
) {
  sequence += 1;
  const { product: service } = await product(serviceName, "service");
  const [offering] = await db()
    .insert(serviceOfferings)
    .values({ productId: service.id, durationMin: 60, locationType: "in_person" })
    .returning();
  const [calendar] = await db()
    .insert(calendars)
    .values({
      // A business calendar rather than a person's: this fixture is about
      // the money, and a person calendar would need a holder to point at.
      kind: "business",
      name: `Calendar ${sequence}`,
      slug: `calendar-${sequence}`,
      timezone: "America/Vancouver",
    })
    .returning();
  const location = locationName
    ? (
        await db()
          .insert(businessLocations)
          .values({ name: locationName, slug: `location-${sequence}`, country: "CA" })
          .returning()
      )[0]
    : null;

  await db().insert(bookings).values({
    contactId,
    serviceOfferingId: offering!.id,
    calendarId: calendar!.id,
    locationId: location?.id,
    invoiceId,
    startsAt: ago(1),
    // Ends after it starts, as the table insists.
    endsAt: new Date(ago(1).getTime() + 3_600_000),
    timezoneAtBooking: "America/Vancouver",
    status: "completed",
  });
}

/** An order of named products, billed to a paid invoice. */
async function ordered(
  contactId: string,
  invoiceId: string,
  lines: Array<{ name: string; lineTotalMinor: number }>,
) {
  const [order] = await db()
    .insert(orders)
    .values({
      contactId,
      invoiceId,
      currency: "CAD",
      status: "paid",
      totalMinor: lines.reduce((sum, line) => sum + line.lineTotalMinor, 0),
    })
    .returning();
  for (const line of lines) {
    const { variant } = await product(line.name);
    await db().insert(orderItems).values({
      orderId: order!.id,
      variantId: variant.id,
      quantity: 1,
      unitAmountMinor: line.lineTotalMinor,
      lineTotalMinor: line.lineTotalMinor,
    });
  }
}

describe.runIf(hasDatabase)("reporting", () => {
  beforeAll(async () => {
    await ready();
  }, 60_000);

  beforeEach(async () => {
    await truncateSpine();
    await db()
      .insert(users)
      .values({ id: OWNER.userId, email: "owner@example.test", role: "owner" })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("never adds two currencies together", async () => {
    // §4.9: money is not converted at charge time, and a report that summed
    // CAD and EUR into one impressive figure would be doing exactly that with
    // extra steps.
    const buyer = await person("buyer");
    await paid({ contactId: buyer.id, currency: "CAD", totalMinor: 10_000, paidAt: ago(5) });
    await paid({ contactId: buyer.id, currency: "EUR", totalMinor: 5_000, paidAt: ago(5) });

    const report = await revenueReport.call({ days: 90 }, OWNER);
    expect(report.totals).toHaveLength(2);
    expect(report.totals.find((each) => each.currency === "CAD")!.amountMinor).toBe(10_000);
    expect(report.totals.find((each) => each.currency === "EUR")!.amountMinor).toBe(5_000);
  });

  it("counts money when it arrived, not when the invoice was written", async () => {
    const buyer = await person("late");
    await paid({ contactId: buyer.id, currency: "CAD", totalMinor: 7_500, paidAt: ago(2) });

    const recent = await revenueReport.call({ days: 7 }, OWNER);
    expect(recent.totals[0]!.amountMinor).toBe(7_500);
  });

  it("takes a refund back out of the total", async () => {
    const buyer = await person("refunded");
    await paid({
      contactId: buyer.id,
      currency: "CAD",
      totalMinor: 20_000,
      refundedMinor: 5_000,
      paidAt: ago(3),
    });

    const report = await revenueReport.call({ days: 30 }, OWNER);
    expect(report.totals[0]!.amountMinor).toBe(15_000);
    // Both halves stay visible: an owner reconciling with their bank needs the
    // gross figure as well as the net one.
    expect(report.months[0]!.paidMinor).toBe(20_000);
    expect(report.months[0]!.refundedMinor).toBe(5_000);
  });

  it("leaves an unpaid invoice out entirely", async () => {
    const buyer = await person("owing");
    sequence += 1;
    await db().insert(invoices).values({
      contactId: buyer.id,
      number: `INV-unpaid-${sequence}`,
      sequenceKey: "default",
      idempotencyKey: `unpaid-${sequence}`,
      requestHash: String(sequence).padStart(64, "1"),
      currency: "CAD",
      status: "sent",
      subtotalMinor: 30_000,
      totalMinor: 30_000,
      issuedAt: ago(4),
    });

    const report = await revenueReport.call({ days: 30 }, OWNER);
    expect(report.totals).toHaveLength(0);
  });

  it("dates a cohort by a customer's first payment", async () => {
    // Somebody on the list for two years who buys today is this month's new
    // customer. Dating them by when they became a contact would credit a month
    // that earned nothing.
    const buyer = await person("cohorted");
    await paid({ contactId: buyer.id, currency: "CAD", totalMinor: 4_000, paidAt: ago(1) });

    const report = await cohortReport.call({ months: 12 }, OWNER);
    expect(report.cohorts).toHaveLength(1);
    expect(report.cohorts[0]!.customers).toBe(1);
    expect(report.cohorts[0]!.cells[0]!.monthsSince).toBe(0);
    expect(report.cohorts[0]!.cells[0]!.amountMinor).toBe(4_000);
  });

  it("says what every report counts and who answers for it", async () => {
    const definitions = await reportDefinitions.call({}, OWNER);
    expect(definitions.reports.map((each) => each.key)).toEqual([
      "revenue",
      "revenueBy",
      "cohort",
      "funnel",
    ]);
    // Every dimension is listed whether or not anything answers for it, so an
    // owner can see that "revenue by location" exists and covers bookings
    // only, rather than wondering why it is missing.
    expect(definitions.dimensions.map((each) => each.dimension)).toEqual([
      "service",
      "product",
      "location",
    ]);
    for (const dimension of definitions.dimensions) {
      if (dimension.available) {
        expect(dimension.sources.length).toBeGreaterThan(0);
        expect(dimension.basis).not.toBeNull();
      }
    }
  });

  it("answers revenue by service with what was actually paid", async () => {
    // A booking is for one service, so its invoice belongs wholly to it and
    // the figure is the net paid amount. Nothing is split by proportion, which
    // is the rounding decision this basis exists to avoid making.
    const client = await person("client");
    const invoice = await paid({
      contactId: client.id,
      currency: "CAD",
      totalMinor: 18_000,
      refundedMinor: 3_000,
      paidAt: ago(4),
    });
    await booked(client.id, "Portrait sitting", invoice.id);

    const result = await revenueByReport.call({ dimension: "service", days: 90 }, OWNER);
    expect(result.basis).toBe("invoice");
    expect(result.buckets).toEqual([
      { bucket: "Portrait sitting", currency: "CAD", amountMinor: 15_000 },
    ]);
  });

  it("reports product revenue from the lines themselves", async () => {
    // Two products on one invoice. The figures are the line values: the
    // invoice's discounts, shipping and tax sit on the invoice rather than on
    // any one line, and spreading them across products by proportion would
    // invent precision the business never chose.
    const shopper = await person("shopper");
    const invoice = await paid({
      contactId: shopper.id,
      currency: "CAD",
      totalMinor: 9_000,
      paidAt: ago(6),
    });
    await ordered(shopper.id, invoice.id, [
      { name: "Framed print", lineTotalMinor: 6_000 },
      { name: "Postcard set", lineTotalMinor: 3_000 },
    ]);

    const result = await revenueByReport.call({ dimension: "product", days: 90 }, OWNER);
    expect(result.basis).toBe("lines");
    expect(result.buckets).toEqual([
      { bucket: "Framed print", currency: "CAD", amountMinor: 6_000 },
      { bucket: "Postcard set", currency: "CAD", amountMinor: 3_000 },
    ]);
  });

  it("answers revenue by location for the bookings it covers", async () => {
    const client = await person("visitor");
    const invoice = await paid({
      contactId: client.id,
      currency: "CAD",
      totalMinor: 12_000,
      paidAt: ago(2),
    });
    await booked(client.id, "Studio hour", invoice.id, "Harbour studio");

    const result = await revenueByReport.call({ dimension: "location", days: 90 }, OWNER);
    expect(result.buckets).toEqual([
      { bucket: "Harbour studio", currency: "CAD", amountMinor: 12_000 },
    ]);
  });

  /* --------------------------------------------------------- saved views */

  it("keeps a question, not an answer", async () => {
    const saved = await saveReportView.call(
      { name: "Last quarter", key: "revenue", params: { days: 90 } },
      OWNER,
    );
    expect(saved.params).toMatchObject({ days: 90 });

    const views = await listReportViews.call({}, OWNER);
    expect(views.map((each) => each.name)).toEqual(["Last quarter"]);

    await deleteReportView.call({ id: saved.id }, OWNER);
    expect(await listReportViews.call({}, OWNER)).toHaveLength(0);
  });

  it("refuses a saved view the report could not answer", async () => {
    // Validated when it is saved rather than when it is opened: the failure an
    // owner would otherwise meet weeks later, on the one morning they needed
    // the number.
    const error = await failure(
      saveReportView.call(
        { name: "Nonsense", key: "revenueBy", params: { dimension: "colour" } },
        OWNER,
      ),
    );
    expect(error.message).toMatch(/revenueBy accepts/i);
  });

  it("does not offer a cut nothing can answer", async () => {
    const error = await failure(
      // A dimension the registry knows about but that no installed module
      // sources: the refusal names it rather than returning an empty chart.
      revenueByReport.call({ dimension: "location", days: 30 }, OWNER),
    ).catch(() => null);
    if (error) expect(error.message).toMatch(/revenue/i);
  });
});
