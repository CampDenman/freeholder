// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Events: venue, sessions, seats, tickets, waitlists, ICS, check-in (C6.11).

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { mailDeliveries } from "@/core/mail/schema";
import { pages } from "@/modules/cms/schema";
import { ensureDefaults, publishedPaths } from "@/modules/cms/service";
import { updateBusiness } from "@/core/settings/service";
import {
  addEventSession,
  addEventTicket,
  cancelRegistration,
  checkInRegistration,
  createEvent,
  eventCalendar,
  expireHeldRegistrations,
  listPublicEvents,
  onInvoiceRefunded,
  publishEvent,
  registerForEvent,
  resolvePublicEvent,
} from "@/modules/events/service";
import { eventRegistrations, events } from "@/modules/events/schema";
import {
  createPayment,
  failPayment,
  settlePayment,
} from "@/modules/invoicing/invoice-service";
import {
  recordOfflinePayment,
  recordOfflineRefund,
} from "@/modules/invoicing/payment-provider-service";
import { beginCustomerCheckout, getCustomerInvoice } from "@/modules/invoicing/customer-service";
import { invoiceAccessToken } from "@/modules/invoicing/customer-tokens";
import { invoices } from "@/modules/invoicing/schema";
import { addTaxRate, createTaxZone, setTaxRegistration } from "@/modules/invoicing/tax-service";
import { createLocationService } from "@/core/locations/service";
import { contacts } from "@/core/contacts/schema";
import { ANONYMOUS, closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";
import { consume, rateLimitKey } from "@/core/security/rate-limit";

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
    const ticket = await addEventTicket.call(
      { eventId: event.id, name: "General", priceMinor: 0, currency: "CAD" },
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
        ticketId: ticket.id,
        email: "ada@example.test",
        name: "Ada",
      },
      ANONYMOUS,
    );
    expect(first.registration.status).toBe("confirmed");
    expect(first.paymentUrl).toBeNull();
    const waiting = await registerForEvent.call(
      {
        eventId: published.id,
        sessionId: session.id,
        ticketId: ticket.id,
        email: "grace@example.test",
        name: "Grace",
      },
      ANONYMOUS,
    );
    expect(waiting.registration.status).toBe("waitlisted");
    expect(waiting.paymentUrl).toBeNull();

    await cancelRegistration.call({ id: first.registration.id }, OWNER);
    const [promoted] = await db()
      .select()
      .from(eventRegistrations)
      .where(eq(eventRegistrations.id, waiting.registration.id));
    expect(promoted?.status).toBe("confirmed");

    const checked = await checkInRegistration.call({ id: waiting.registration.id }, OWNER);
    expect(checked.status).toBe("checked_in");

    const ics = await eventCalendar.call({ slug: "coast-workshop" }, ANONYMOUS);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("SUMMARY:Coast workshop");
    expect(ics).toContain("LOCATION:Studio 3\\, 210 Fifth Street\\, Courtenay");
  });

  it("builds an event page from its title and the event, with no landing-page placeholder", async () => {
    // The seeded templates, as every real site has them.
    await ensureDefaults.call({}, OWNER);
    const event = await createEvent.call({ name: "Print walk", slug: "print-walk" }, OWNER);
    await publishEvent.call({ id: event.id, expectedVersion: event.version }, OWNER);
    const [page] = await db().select().from(pages).where(eq(pages.slug, "events/print-walk"));
    const blocks = page!.blocks as Array<{ type: string; props: Record<string, unknown> }>;
    expect(blocks.map((block) => block.type)).toEqual(["heading", "eventDetail"]);
    expect(blocks[0]!.props.text).toBe("Print walk");
    expect(JSON.stringify(blocks)).not.toContain("block tree");
  });

  it("lists only events with a live page: upcoming first, finished ones marked past", async () => {
    const hour = 60 * 60 * 1000;
    async function published(slug: string, startsAt: Date) {
      const event = await createEvent.call({ name: slug, slug }, OWNER);
      await addEventSession.call(
        { eventId: event.id, startsAt, endsAt: new Date(startsAt.getTime() + 2 * hour), capacity: 5, waitlistEnabled: false },
        OWNER,
      );
      return publishEvent.call({ id: event.id, expectedVersion: event.version }, OWNER);
    }
    await published("later", new Date(Date.now() + 72 * hour));
    await published("sooner", new Date(Date.now() + 24 * hour));
    await published("finished", new Date(Date.now() - 72 * hour));
    // Published without a page — the state the busy demo's bulk insert left
    // its past events in. The list must not link to a 404.
    await db().insert(events).values({ name: "Orphan", slug: "orphan", status: "published", publishedAt: new Date() });

    const listed = await listPublicEvents.call({}, ANONYMOUS);
    expect(listed.map((event) => event.slug)).toEqual(["sooner", "later", "finished"]);
    expect(listed[0]!.nextStartsAt).toBeInstanceOf(Date);
    expect(listed[0]!.nextTimezone).toBeTruthy();
    expect(listed[0]!.endedAt).toBeNull();
    expect(listed[2]!.endedAt).toBeInstanceOf(Date);
    expect(listed[2]!.nextStartsAt).toBeNull();

    // A finished event keeps a viewable page, in the sitemap like the rest.
    const paths = await publishedPaths.call({ locale: "en" }, ANONYMOUS);
    expect(paths.map((entry) => entry.slug)).toEqual(expect.arrayContaining(["events/finished"]));
    expect(paths.map((entry) => entry.slug)).not.toContain("events/orphan");
    expect(await resolvePublicEvent.call({ slug: "finished" }, ANONYMOUS)).toMatchObject({ slug: "finished" });
  });
});

describe.runIf(hasDatabase)("paid event admission (C6.11)", { timeout: 30_000 }, () => {
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

  async function paidClass(capacity = 2, priceMinor = 6_500) {
    const event = await createEvent.call(
      { name: "Sourdough class", slug: `sourdough-${crypto.randomUUID().slice(0, 8)}` },
      OWNER,
    );
    const session = await addEventSession.call(
      {
        eventId: event.id,
        startsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
        capacity,
        waitlistEnabled: true,
      },
      OWNER,
    );
    const ticket = await addEventTicket.call(
      { eventId: event.id, name: "General", priceMinor, currency: "CAD" },
      OWNER,
    );
    const published = await publishEvent.call({ id: event.id, expectedVersion: event.version }, OWNER);
    return { event: published, session, ticket };
  }

  function tokenOf(paymentUrl: string | null): string {
    return new URL(paymentUrl!).searchParams.get("token")!;
  }

  it("sells a paid seat: reserved hold, issued invoice, settlement confirms, check-in reports the invoice", async () => {
    const { event, session, ticket } = await paidClass(2);
    const held = await registerForEvent.call(
      { eventId: event.id, sessionId: session.id, ticketId: ticket.id, email: "bea@example.test", name: "Bea" },
      ANONYMOUS,
    );
    expect(held.registration.status).toBe("reserved");
    expect(held.registration.invoiceId).toBeTruthy();
    expect(held.registration.holdExpiresAt).toBeInstanceOf(Date);
    expect(held.registration.holdExpiresAt!.getTime() - Date.now()).toBeGreaterThan(29 * 60 * 1000);
    expect(held.paymentUrl).toContain(`/portal/invoices/${held.registration.invoiceId}?token=`);

    const [invoice] = await db().select().from(invoices).where(eq(invoices.id, held.registration.invoiceId!));
    expect(invoice).toMatchObject({ sourceType: "event", sourceId: held.registration.id, status: "sent", totalMinor: 6_500 });

    // The hold occupies the seat for everybody else.
    const view = await resolvePublicEvent.call({ slug: event.slug }, ANONYMOUS);
    expect(view?.sessions[0]?.remaining).toBe(1);

    // A held seat is not admission: check-in refuses before settlement.
    await failure(checkInRegistration.call({ id: held.registration.id }, OWNER));

    // The owner records the offline payment; settlement confirms the seat.
    await recordOfflinePayment.call(
      {
        invoiceId: invoice!.id,
        method: "cash",
        amountMinor: 6_500,
        evidence: "Cash counted at the door list price.",
        idempotencyKey: `paid-${held.registration.id}`,
      },
      OWNER,
    );
    const [confirmed] = await db().select().from(eventRegistrations).where(eq(eventRegistrations.id, held.registration.id));
    expect(confirmed?.status).toBe("confirmed");

    const checked = await checkInRegistration.call({ id: held.registration.id }, OWNER);
    expect(checked.status).toBe("checked_in");
    expect(checked.invoiceId).toBe(invoice!.id);
  });

  it("blocks further seats while a hold is live and serializes overflow onto the waitlist without an invoice", async () => {
    const { event, session, ticket } = await paidClass(1);
    const [first, second] = await Promise.all([
      registerForEvent.call(
        { eventId: event.id, sessionId: session.id, ticketId: ticket.id, email: "one@example.test" },
        ANONYMOUS,
      ),
      registerForEvent.call(
        { eventId: event.id, sessionId: session.id, ticketId: ticket.id, email: "two@example.test" },
        ANONYMOUS,
      ),
    ]);
    const statuses = [first.registration.status, second.registration.status].sort();
    expect(statuses).toEqual(["reserved", "waitlisted"]);
    const waitlisted = [first, second].find((entry) => entry.registration.status === "waitlisted")!;
    expect(waitlisted.registration.invoiceId).toBeNull();
    expect(waitlisted.paymentUrl).toBeNull();
  });

  it("keeps a partial payment reserved and out of the sweeper's reach", async () => {
    const { event, session, ticket } = await paidClass(1);
    const held = await registerForEvent.call(
      { eventId: event.id, sessionId: session.id, ticketId: ticket.id, email: "part@example.test" },
      ANONYMOUS,
    );
    const payment = await createPayment.call(
      {
        invoiceId: held.registration.invoiceId!,
        provider: "manual",
        method: "bank_transfer",
        amountMinor: 3_000,
        idempotencyKey: `partial-${held.registration.id}`,
      },
      OWNER,
    );
    await settlePayment.call({ id: payment.id, providerRef: "manual:partial" }, OWNER);
    const [registration] = await db().select().from(eventRegistrations).where(eq(eventRegistrations.id, held.registration.id));
    expect(registration?.status).toBe("reserved");
    const [invoice] = await db().select().from(invoices).where(eq(invoices.id, held.registration.invoiceId!));
    expect(invoice?.status).toBe("partially_paid");

    // Money arrived, so the hold is the owner's to reconcile, not the
    // sweeper's to release — even past its deadline.
    await db().update(eventRegistrations)
      .set({ holdExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(eventRegistrations.id, held.registration.id));
    const swept = await expireHeldRegistrations.call({}, { kind: "system" });
    expect(swept.expired).toBe(0);
    const [still] = await db().select().from(eventRegistrations).where(eq(eventRegistrations.id, held.registration.id));
    expect(still?.status).toBe("reserved");
  });

  it("taxes admission where the event happens, and a free-text venue at the business's location", async () => {
    const studio = await createLocationService.call({ name: "Studio", slug: "studio", city: "Courtenay", region: "BC", country: "CA" }, OWNER);
    const zone = await createTaxZone.call(
      { name: "Canada", country: "CA", regions: [], postalPatterns: [], basis: "destination", pricesIncludeTax: false, roundingScope: "invoice", roundingMode: "half_up" },
      OWNER,
    );
    await setTaxRegistration.call({ zoneId: zone.id, number: "123456789RT0001", status: "active" }, OWNER);
    await addTaxRate.call({ zoneId: zone.id, name: "GST", jurisdiction: "Canada", ratePpm: 50_000, appliesToShipping: false }, OWNER);
    const invoiceFor = async (venue: { venueLocationId?: string; venueName?: string; venueAddress?: string }) => {
      const event = await createEvent.call({ name: "Taxed class", slug: `taxed-${crypto.randomUUID().slice(0, 8)}`, ...venue }, OWNER);
      const session = await addEventSession.call(
        { eventId: event.id, startsAt: new Date(Date.now() + 7 * 86_400_000), endsAt: new Date(Date.now() + 7 * 86_400_000 + 3_600_000), capacity: 5, waitlistEnabled: false },
        OWNER,
      );
      const ticket = await addEventTicket.call({ eventId: event.id, name: "General", priceMinor: 6_500, currency: "CAD" }, OWNER);
      await publishEvent.call({ id: event.id, expectedVersion: event.version }, OWNER);
      const held = await registerForEvent.call(
        { eventId: event.id, sessionId: session.id, ticketId: ticket.id, email: `taxed-${crypto.randomUUID().slice(0, 8)}@example.test` },
        ANONYMOUS,
      );
      const [invoice] = await db().select().from(invoices).where(eq(invoices.id, held.registration.invoiceId!));
      return invoice!;
    };
    // At the business, or at a saved location: taxed there.
    const atBusiness = await invoiceFor({});
    expect(atBusiness).toMatchObject({ subtotalMinor: 6_500, taxMinor: 325, totalMinor: 6_825 });
    // The customer's copy lists the admission at its pre-tax amount, so the
    // lines add up to the subtotal printed under them and the tax is shown
    // once (2026-10-23 pre-launch check: the line read CA$106.40 above a
    // CA$95.00 subtotal and CA$11.40 tax).
    const customerCopy = await getCustomerInvoice.call({ id: atBusiness.id, token: invoiceAccessToken(atBusiness) }, ANONYMOUS);
    expect(customerCopy.lines.map((line) => line.amountMinor)).toEqual([6_500]);
    expect(customerCopy.lines.reduce((sum, line) => sum + line.amountMinor, 0))
      .toBe(customerCopy.subtotalMinor - customerCopy.discountMinor);
    expect(customerCopy.subtotalMinor - customerCopy.discountMinor + customerCopy.shippingMinor + customerCopy.taxMinor)
      .toBe(customerCopy.totalMinor);
    expect(await invoiceFor({ venueLocationId: studio.id })).toMatchObject({ taxMinor: 325, totalMinor: 6_825 });
    // A venue typed as free text cannot be placed in a jurisdiction: it is
    // taxed as if held at the business, and the invoice says so.
    const elsewhere = await invoiceFor({ venueName: "Community hall", venueAddress: "12 Main St, Banff" });
    expect(elsewhere).toMatchObject({ taxMinor: 325, totalMinor: 6_825 });
    expect(elsewhere.memo).toMatch(/worked out at the business's location/);
  });

  it("reaches newer lapsed holds before ones a payment attempt is still holding", async () => {
    const first = await paidClass(1);
    const inflight = await registerForEvent.call(
      { eventId: first.event.id, sessionId: first.session.id, ticketId: first.ticket.id, email: "inflight2@example.test" },
      ANONYMOUS,
    );
    await createPayment.call(
      { invoiceId: inflight.registration.invoiceId!, provider: "manual", method: "bank_transfer", amountMinor: first.ticket.priceMinor, idempotencyKey: `inflight2-${inflight.registration.id}` },
      OWNER,
    );
    const second = await paidClass(1);
    const lapsed = await registerForEvent.call(
      { eventId: second.event.id, sessionId: second.session.id, ticketId: second.ticket.id, email: "lapsed4@example.test" },
      ANONYMOUS,
    );
    // The held one lapsed first, so oldest-first alone would pick it every time.
    await db().update(eventRegistrations).set({ holdExpiresAt: new Date(Date.now() - 120_000) }).where(eq(eventRegistrations.id, inflight.registration.id));
    await db().update(eventRegistrations).set({ holdExpiresAt: new Date(Date.now() - 60_000) }).where(eq(eventRegistrations.id, lapsed.registration.id));
    expect(await expireHeldRegistrations.call({ limit: 1 }, { kind: "system" })).toEqual({ expired: 1, blocked: 0, failed: 0 });
    const [released] = await db().select().from(eventRegistrations).where(eq(eventRegistrations.id, lapsed.registration.id));
    expect(released?.status).toBe("cancelled");
  });

  it("releases every other lapsed hold when one cannot be released", async () => {
    const first = await paidClass(1);
    const stuck = await registerForEvent.call(
      { eventId: first.event.id, sessionId: first.session.id, ticketId: first.ticket.id, email: "stuck@example.test" },
      ANONYMOUS,
    );
    await registerForEvent.call(
      { eventId: first.event.id, sessionId: first.session.id, ticketId: first.ticket.id, email: "erased@example.test" },
      ANONYMOUS,
    );
    // The next in line has since had their email erased, so promoting them
    // cannot send the invoice that is their notification.
    await db().update(contacts).set({ email: null }).where(eq(contacts.email, "erased@example.test"));
    const second = await paidClass(1);
    const lapsed = await registerForEvent.call(
      { eventId: second.event.id, sessionId: second.session.id, ticketId: second.ticket.id, email: "lapsed3@example.test" },
      ANONYMOUS,
    );
    await db().update(eventRegistrations).set({ holdExpiresAt: new Date(Date.now() - 120_000) }).where(eq(eventRegistrations.id, stuck.registration.id));
    await db().update(eventRegistrations).set({ holdExpiresAt: new Date(Date.now() - 60_000) }).where(eq(eventRegistrations.id, lapsed.registration.id));

    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const swept = await expireHeldRegistrations.call({}, { kind: "system" });
    expect(swept).toEqual({ expired: 1, blocked: 0, failed: 1 });
    expect(errors).toHaveBeenCalledTimes(1);
    errors.mockRestore();
    const [released] = await db().select().from(eventRegistrations).where(eq(eventRegistrations.id, lapsed.registration.id));
    expect(released?.status).toBe("cancelled");
    // The one that failed is left exactly as it was, for the next sweep or the owner.
    const [kept] = await db().select().from(eventRegistrations).where(eq(eventRegistrations.id, stuck.registration.id));
    expect(kept?.status).toBe("reserved");
  });

  it("expires a lapsed hold: seat released, invoice voided, waitlisted paid row promoted with a fresh invoice by email", async () => {
    const { event, session, ticket } = await paidClass(1);
    const held = await registerForEvent.call(
      { eventId: event.id, sessionId: session.id, ticketId: ticket.id, email: "lapsed@example.test" },
      ANONYMOUS,
    );
    const waiting = await registerForEvent.call(
      { eventId: event.id, sessionId: session.id, ticketId: ticket.id, email: "next@example.test", name: "Next" },
      ANONYMOUS,
    );
    expect(waiting.registration.status).toBe("waitlisted");

    await db().update(eventRegistrations)
      .set({ holdExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(eventRegistrations.id, held.registration.id));
    const swept = await expireHeldRegistrations.call({}, { kind: "system" });
    expect(swept.expired).toBe(1);

    const [released] = await db().select().from(eventRegistrations).where(eq(eventRegistrations.id, held.registration.id));
    expect(released?.status).toBe("cancelled");
    const [voided] = await db().select().from(invoices).where(eq(invoices.id, held.registration.invoiceId!));
    expect(voided?.status).toBe("void");

    const [promoted] = await db().select().from(eventRegistrations).where(eq(eventRegistrations.id, waiting.registration.id));
    expect(promoted?.status).toBe("reserved");
    expect(promoted?.invoiceId).toBeTruthy();
    expect(promoted?.holdExpiresAt?.getTime()).toBeGreaterThan(Date.now());
    const [offer] = await db().select().from(invoices).where(eq(invoices.id, promoted!.invoiceId!));
    expect(offer).toMatchObject({ sourceType: "event", sourceId: promoted!.id, status: "sent" });
    // The emailed invoice is the waitlist notification; it carries the pay link.
    const mail = await db().select().from(mailDeliveries);
    expect(mail.some((row) => row.recipient === "next@example.test")).toBe(true);
  });

  it("never releases a seat while a payment attempt is in flight, however stale the hold", async () => {
    const { event, session, ticket } = await paidClass(1);
    const held = await registerForEvent.call(
      { eventId: event.id, sessionId: session.id, ticketId: ticket.id, email: "inflight@example.test" },
      ANONYMOUS,
    );
    // The provider checkout started before the hold lapsed: an attempt is
    // active, so neither the owner nor the sweeper may release the seat —
    // settlement could still legitimately arrive (catalog.cancelOrder's rule).
    const attempt = await createPayment.call(
      {
        invoiceId: held.registration.invoiceId!,
        provider: "manual",
        method: "bank_transfer",
        amountMinor: ticket.priceMinor,
        idempotencyKey: `inflight-${held.registration.id}`,
      },
      OWNER,
    );
    await db().update(eventRegistrations)
      .set({ holdExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(eventRegistrations.id, held.registration.id));

    await expect(
      cancelRegistration.call({ id: held.registration.id }, OWNER),
    ).rejects.toThrow("payment attempt is still active");
    const swept = await expireHeldRegistrations.call({}, { kind: "system" });
    expect(swept.expired).toBe(0);
    const [still] = await db().select().from(eventRegistrations).where(eq(eventRegistrations.id, held.registration.id));
    expect(still?.status).toBe("reserved");

    // The attempt's own lifecycle is what unblocks the seat: once it fails
    // terminally, the sweep releases the hold and voids the invoice.
    await failPayment.call({ id: attempt.id, message: "expired at the provider" }, OWNER);
    const sweptAfter = await expireHeldRegistrations.call({}, { kind: "system" });
    expect(sweptAfter.expired).toBe(1);
    const [released] = await db().select().from(eventRegistrations).where(eq(eventRegistrations.id, held.registration.id));
    expect(released?.status).toBe("cancelled");
  });

  it("promotes a free waitlisted row to confirmed when a hold lapses", async () => {
    const { event, session, ticket } = await paidClass(1);
    const free = await addEventTicket.call(
      { eventId: event.id, name: "Pay at the door", priceMinor: 0, currency: "CAD" },
      OWNER,
    );
    const held = await registerForEvent.call(
      { eventId: event.id, sessionId: session.id, ticketId: ticket.id, email: "lapsed2@example.test" },
      ANONYMOUS,
    );
    const waiting = await registerForEvent.call(
      { eventId: event.id, sessionId: session.id, ticketId: free.id, email: "free-next@example.test" },
      ANONYMOUS,
    );
    expect(waiting.registration.status).toBe("waitlisted");

    await db().update(eventRegistrations)
      .set({ holdExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(eventRegistrations.id, held.registration.id));
    await expireHeldRegistrations.call({}, { kind: "system" });

    const [promoted] = await db().select().from(eventRegistrations).where(eq(eventRegistrations.id, waiting.registration.id));
    expect(promoted?.status).toBe("confirmed");
    expect(promoted?.invoiceId).toBeNull();
  });

  it("refuses checkout once the hold has lapsed or the registration is cancelled", async () => {
    const { event, session, ticket } = await paidClass(2);
    const held = await registerForEvent.call(
      { eventId: event.id, sessionId: session.id, ticketId: ticket.id, email: "payer@example.test" },
      ANONYMOUS,
    );
    const access = { id: held.registration.invoiceId!, token: tokenOf(held.paymentUrl) };
    // A live hold can pay: the manual adapter answers with offline instructions.
    const begun = await beginCustomerCheckout.call(access, ANONYMOUS);
    expect(begun.url).toContain(`/portal/invoices/${held.registration.invoiceId}`);

    await cancelRegistration.call({ id: held.registration.id }, OWNER);
    const [voided] = await db().select().from(invoices).where(eq(invoices.id, held.registration.invoiceId!));
    expect(voided?.status).toBe("void");
    expect(await failure(beginCustomerCheckout.call(access, ANONYMOUS))).toMatchObject({ code: "not_found" });

    const again = await registerForEvent.call(
      { eventId: event.id, sessionId: session.id, ticketId: ticket.id, email: "late@example.test" },
      ANONYMOUS,
    );
    await db().update(eventRegistrations)
      .set({ holdExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(eventRegistrations.id, again.registration.id));
    expect(
      await failure(
        beginCustomerCheckout.call(
          { id: again.registration.invoiceId!, token: tokenOf(again.paymentUrl) },
          ANONYMOUS,
        ),
      ),
    ).toMatchObject({ code: "conflict" });
  });

  it("cancels a settled seat with its invoice id reported, and only a deliberate refund releases it to the waitlist", async () => {
    const { event, session, ticket } = await paidClass(1);
    const held = await registerForEvent.call(
      { eventId: event.id, sessionId: session.id, ticketId: ticket.id, email: "settled@example.test" },
      ANONYMOUS,
    );
    await recordOfflinePayment.call(
      {
        invoiceId: held.registration.invoiceId!,
        method: "cash",
        amountMinor: 6_500,
        evidence: "Cash counted.",
        idempotencyKey: `settled-${held.registration.id}`,
      },
      OWNER,
    );
    const waiting = await registerForEvent.call(
      { eventId: event.id, sessionId: session.id, ticketId: ticket.id, email: "standby@example.test" },
      ANONYMOUS,
    );
    expect(waiting.registration.status).toBe("waitlisted");

    // Cancelling a settled registration reports the invoice and leaves the
    // money alone: no auto-refund, no seat release without one... but the seat
    // itself frees, so the waitlist moves.
    const cancelled = await cancelRegistration.call({ id: held.registration.id }, OWNER);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.invoiceId).toBe(held.registration.invoiceId);
    const [invoice] = await db().select().from(invoices).where(eq(invoices.id, held.registration.invoiceId!));
    expect(invoice?.status).toBe("paid");
    const [promoted] = await db().select().from(eventRegistrations).where(eq(eventRegistrations.id, waiting.registration.id));
    expect(promoted?.status).toBe("reserved");
    expect(promoted?.invoiceId).toBeTruthy();

    // The deliberate refund of a settled ticket cancels the registration and
    // runs the promotion cascade through the invoice.refunded listener.
    const second = await registerForEvent.call(
      { eventId: event.id, sessionId: session.id, ticketId: ticket.id, email: "refunded@example.test" },
      ANONYMOUS,
    );
    expect(second.registration.status).toBe("waitlisted");
    // The promoted row holds the seat now; settle it, then refund it.
    const promotedPayment = await recordOfflinePayment.call(
      {
        invoiceId: promoted!.invoiceId!,
        method: "bank_transfer",
        amountMinor: 6_500,
        evidence: "Transfer verified against the statement.",
        idempotencyKey: `promoted-${promoted!.id}`,
      },
      OWNER,
    );
    const refund = await recordOfflineRefund.call(
      {
        paymentId: promotedPayment.id,
        amountMinor: 6_500,
        reason: "Attendee asked before the class.",
        idempotencyKey: `refund-${promoted!.id}`,
      },
      OWNER,
    );
    expect(refund.status).toBe("succeeded");
    // Bus listeners run post-commit; the suite invokes the handler the way
    // the bus would (precedent: tests call onOrderPaid directly).
    await onInvoiceRefunded({ invoiceId: promoted!.invoiceId! });
    const [refundedRow] = await db().select().from(eventRegistrations).where(eq(eventRegistrations.id, promoted!.id));
    expect(refundedRow?.status).toBe("cancelled");
    const [promotedAgain] = await db().select().from(eventRegistrations).where(eq(eventRegistrations.id, second.registration.id));
    expect(promotedAgain?.status).toBe("reserved");
    expect(promotedAgain?.invoiceId).toBeTruthy();
  });

  it("refuses a duplicate live registration for the same contact and session", async () => {
    const { event, session, ticket } = await paidClass(5);
    const input = { eventId: event.id, sessionId: session.id, ticketId: ticket.id, email: "twice@example.test" };
    const first = await registerForEvent.call(input, ANONYMOUS);
    expect(first.registration.status).toBe("reserved");
    // A different ask from the same person is a conflict, not a second seat.
    expect(await failure(registerForEvent.call({ ...input, quantity: 2 }, ANONYMOUS))).toMatchObject({ code: "conflict" });

    // Cancelling frees the person to register again.
    await cancelRegistration.call({ id: first.registration.id }, OWNER);
    const second = await registerForEvent.call(input, ANONYMOUS);
    expect(second.registration.status).toBe("reserved");
    expect(second.registration.id).not.toBe(first.registration.id);
  });

  it("answers a repeated paid submit with the same hold and invoice, not a failure or a second invoice", async () => {
    // 2026-10-23 audit: a double submit of "Register and pay" created the hold
    // and invoice, then the twin request reported failure=invalid. The same
    // rendered form repeats its token, so the repeat is recognised.
    const { event, session, ticket } = await paidClass(8);
    const input = {
      eventId: event.id,
      sessionId: session.id,
      ticketId: ticket.id,
      email: "ada@example.test",
      name: "Ada Example",
      submissionToken: "form-token-ada-0123456789",
    };
    const [first, second] = await Promise.all([
      registerForEvent.call(input, ANONYMOUS),
      registerForEvent.call(input, ANONYMOUS),
    ]);
    expect(second.registration.id).toBe(first.registration.id);
    expect(second.paymentUrl).toBe(first.paymentUrl);
    expect(first.paymentUrl).toContain(`/portal/invoices/${first.registration.invoiceId}?token=`);
    // The token's hash is the service's own business.
    expect(first.registration).not.toHaveProperty("submissionTokenHash", expect.anything());
    const third = await registerForEvent.call(input, ANONYMOUS);
    expect(third.registration.id).toBe(first.registration.id);

    const rows = await db().select().from(eventRegistrations).where(eq(eventRegistrations.sessionId, session.id));
    expect(rows).toHaveLength(1);
    const issued = await db().select().from(invoices).where(eq(invoices.sourceId, first.registration.id));
    expect(issued).toHaveLength(1);
    const view = await resolvePublicEvent.call({ slug: event.slug }, ANONYMOUS);
    expect(view?.sessions[0]?.remaining).toBe(7);

    // Once the hold has lapsed the same ask is no longer a replay.
    await db()
      .update(eventRegistrations)
      .set({ holdExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(eventRegistrations.id, first.registration.id));
    expect(await failure(registerForEvent.call(input, ANONYMOUS))).toMatchObject({ code: "conflict" });
  });

  it("never hands a paid registration's invoice to someone who only knows the email", async () => {
    const { event, session, ticket } = await paidClass(8);
    const base = { eventId: event.id, sessionId: session.id, ticketId: ticket.id, email: "victim@example.test" };
    const first = await registerForEvent.call(
      { ...base, name: "Real Person", submissionToken: "the-victims-own-form-token" },
      ANONYMOUS,
    );
    expect(first.paymentUrl).toBeTruthy();
    // Another browser: a different form token, or none at all.
    for (const attempt of [{ ...base, submissionToken: "a-strangers-form-token-xx" }, base]) {
      const refused = await failure(registerForEvent.call(attempt, ANONYMOUS));
      // The same refusal a full or closed session gets: nothing to tell apart.
      expect(refused.code).toBe("conflict");
      expect(JSON.stringify(refused)).not.toContain("/portal/invoices/");
      expect(refused.message).not.toContain("/portal/invoices/");
    }
    expect(await db().select().from(invoices).where(eq(invoices.sourceId, first.registration.id))).toHaveLength(1);
    expect(await db().select().from(eventRegistrations).where(eq(eventRegistrations.sessionId, session.id))).toHaveLength(1);
  });

  it("counts refused public attempts toward the rate limit", async () => {
    const { event, session, ticket } = await paidClass(8);
    const base = { eventId: event.id, sessionId: session.id, ticketId: ticket.id, email: "probe@example.test" };
    await registerForEvent.call({ ...base, submissionToken: "the-owners-form-token-0001" }, ANONYMOUS);
    const codes: string[] = [];
    for (let attempt = 0; attempt < 45; attempt += 1) {
      codes.push((await failure(registerForEvent.call(base, ANONYMOUS))).code);
    }
    // Refusals roll their transaction back, but the attempt still counted.
    expect(codes.slice(0, 39).every((code) => code === "conflict")).toBe(true);
    expect(codes.at(-1)).toBe("rate_limited");
  });

  it("refuses a session time zone Intl does not know", async () => {
    const event = await createEvent.call({ name: "Zone typo", slug: "zone-typo" }, OWNER);
    const startsAt = new Date(Date.now() + 86_400_000);
    expect(
      await failure(
        addEventSession.call(
          { eventId: event.id, startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000), capacity: 4, timezone: "America/Vancuver" },
          OWNER,
        ),
      ),
    ).toMatchObject({ code: "validation" });
  });

  it("answers a repeated free submit with the same confirmed seat", async () => {
    const { event, session, ticket } = await paidClass(4, 0);
    const input = {
      eventId: event.id,
      sessionId: session.id,
      ticketId: ticket.id,
      email: "free@example.test",
      submissionToken: "form-token-free-0123456789",
    };
    const first = await registerForEvent.call(input, ANONYMOUS);
    const again = await registerForEvent.call(input, ANONYMOUS);
    expect(again).toMatchObject({ paymentUrl: null, registration: { id: first.registration.id, status: "confirmed" } });
  });

  it("writes nothing when a paid registration is refused", async () => {
    const event = await createEvent.call({ name: "Tiny class", slug: "tiny-class" }, OWNER);
    const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const session = await addEventSession.call(
      { eventId: event.id, startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000), capacity: 1, waitlistEnabled: false },
      OWNER,
    );
    const ticket = await addEventTicket.call({ eventId: event.id, name: "Seat", priceMinor: 9_000, currency: "CAD" }, OWNER);
    await publishEvent.call({ id: event.id, expectedVersion: event.version }, OWNER);
    const base = { eventId: event.id, sessionId: session.id, ticketId: ticket.id };
    await registerForEvent.call({ ...base, email: "first@example.test" }, ANONYMOUS);
    const before = await db().select().from(invoices);

    expect(await failure(registerForEvent.call({ ...base, email: "late@example.test", name: "Late" }, ANONYMOUS)))
      .toMatchObject({ code: "conflict" });
    expect(await db().select().from(contacts).where(eq(contacts.email, "late@example.test"))).toHaveLength(0);
    expect(await db().select().from(invoices)).toHaveLength(before.length);
    expect(await db().select().from(eventRegistrations).where(eq(eventRegistrations.sessionId, session.id))).toHaveLength(1);
  });

  it("caps the free seats one public registration can take, but not staff's (C11.10)", async () => {
    const { event, session, ticket } = await paidClass(100, 0);
    const base = { eventId: event.id, sessionId: session.id, ticketId: ticket.id };
    expect(
      await failure(registerForEvent.call({ ...base, email: "made-up@example.test", quantity: 50 }, ANONYMOUS)),
    ).toMatchObject({ code: "validation" });
    const party = await registerForEvent.call({ ...base, email: "party@example.test", quantity: 10 }, ANONYMOUS);
    expect(party.registration.status).toBe("confirmed");
    const block = await registerForEvent.call({ ...base, email: "school@example.test", quantity: 40 }, OWNER);
    expect(block.registration.quantity).toBe(40);
  });

  it("bounds public registrations per address (C11.10)", async () => {
    const codes: string[] = [];
    for (let index = 0; index < 11; index++) {
      const { event, session, ticket } = await paidClass(5, 0);
      codes.push(
        await registerForEvent.call(
          { eventId: event.id, sessionId: session.id, ticketId: ticket.id, email: "flood@example.test" },
          ANONYMOUS,
        ).then(() => "ok", (error: { code?: string }) => error.code ?? "error"),
      );
    }
    expect(codes.slice(0, 10).every((code) => code === "ok")).toBe(true);
    expect(codes[10]).toBe("rate_limited");
  }, 120_000);

  it("stops one client cycling made-up addresses, even without a trusted proxy (C11.10)", async () => {
    const { event, session, ticket } = await paidClass(100, 0);
    const key = rateLimitKey("events.register", "untrusted-ip:203.0.113.60");
    for (let index = 0; index < 30; index++) await consume(key, { limit: 30, windowSeconds: 3600 });
    const base = { eventId: event.id, sessionId: session.id, ticketId: ticket.id };
    expect(
      await failure(registerForEvent.call({ ...base, email: "new-name@example.test" }, { kind: "anonymous", request: { ip: "203.0.113.60" } })),
    ).toMatchObject({ code: "rate_limited" });
    const other = await registerForEvent.call({ ...base, email: "neighbour@example.test" }, { kind: "anonymous", request: { ip: "203.0.113.61" } });
    expect(other.registration.status).toBe("confirmed");
  }, 120_000);
});
