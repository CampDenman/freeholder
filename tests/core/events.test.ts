// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Events: venue, sessions, seats, tickets, waitlists, ICS, check-in (C6.11).

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import { mailDeliveries } from "@/core/mail/schema";
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
  expireHeldRegistrations,
  onInvoiceRefunded,
  publishEvent,
  registerForEvent,
  resolvePublicEvent,
} from "@/modules/events/service";
import { eventRegistrations } from "@/modules/events/schema";
import {
  createPayment,
  failPayment,
  settlePayment,
} from "@/modules/invoicing/invoice-service";
import {
  recordOfflinePayment,
  recordOfflineRefund,
} from "@/modules/invoicing/payment-provider-service";
import { beginCustomerCheckout } from "@/modules/invoicing/customer-service";
import { invoices } from "@/modules/invoicing/schema";
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
    expect(await failure(registerForEvent.call(input, ANONYMOUS))).toMatchObject({ code: "conflict" });

    // Cancelling frees the person to register again.
    await cancelRegistration.call({ id: first.registration.id }, OWNER);
    const second = await registerForEvent.call(input, ANONYMOUS);
    expect(second.registration.status).toBe("reserved");
    expect(second.registration.id).not.toBe(first.registration.id);
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
