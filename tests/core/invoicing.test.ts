// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.02-C5.05 database proof for the convergent money path.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import {
  createContact,
  mergeContacts,
  undoContactMerge,
} from "@/core/contacts/service";
import { contacts } from "@/core/contacts/schema";
import {
  addTaxRate,
  createTaxZone,
  installTaxTemplate,
  listTaxThresholds,
  listTaxTemplates,
  quoteTax,
  setTaxExemption,
  setTaxRegistration,
} from "@/modules/invoicing/tax-service";
import {
  cancelPayment,
  cancelRefund,
  createCreditNote,
  createDraftInvoice,
  createPayment,
  createRefund,
  getInvoice,
  getPaymentReceipt,
  issueCreditNote,
  issueInvoice,
  reconcileMoney,
  settlePayment,
  settleRefund,
} from "@/modules/invoicing/invoice-service";
import {
  creditNotes,
  invoiceSequences,
  invoices,
  moneyStateEvents,
  payments,
  refunds,
  taxExemptions,
  taxLines,
  taxRates,
  taxRegistrations,
  taxZones,
} from "@/modules/invoicing/schema";
import {
  closeDb,
  failure,
  hasDatabase,
  OWNER,
  truncateSpine,
} from "../helpers/spine";

async function contact(name = "Ada Lovelace", email = "ada@example.test") {
  return createContact.call({ name, email }, OWNER);
}

const explicitNoTax = {
  mode: "not_applicable" as const,
  reason: "No collection obligation applies to this test transaction.",
};

function draftInput(contactId: string, key: string, amountMinor = 10_000) {
  return {
    contactId,
    currency: "CAD",
    idempotencyKey: key,
    lines: [
      {
        description: "Professional service",
        quantityMicros: 1_000_000,
        unitAmountMinor: amountMinor,
        discountMinor: 0,
        taxCategoryCode: "standard",
        requiresShipping: false,
        snapshot: { source: "test" },
      },
    ],
    shippingMinor: 0,
    tax: explicitNoTax,
  };
}

describe.runIf(hasDatabase)("tax configuration and quoting", () => {
  beforeEach(truncateSpine);

  it("chooses the most-specific destination zone and snapshots explainable rates", async () => {
    const buyer = await contact();
    const canada = await createTaxZone.call(
      {
        name: "Canada fallback",
        country: "CA",
        regions: [],
        postalPatterns: [],
        priority: 0,
        basis: "destination",
        pricesIncludeTax: false,
        roundingScope: "line",
        roundingMode: "half_up",
      },
      OWNER,
    );
    const bc = await createTaxZone.call(
      {
        name: "British Columbia",
        country: "CA",
        regions: ["BC"],
        postalPatterns: [],
        priority: 10,
        basis: "destination",
        pricesIncludeTax: false,
        roundingScope: "line",
        roundingMode: "half_up",
      },
      OWNER,
    );
    await Promise.all([
      setTaxRegistration.call(
        { zoneId: canada.id, number: "GST-CA", status: "active" },
        OWNER,
      ),
      setTaxRegistration.call(
        { zoneId: bc.id, number: "GST-BC", status: "active" },
        OWNER,
      ),
    ]);
    await addTaxRate.call(
      {
        zoneId: canada.id,
        name: "GST",
        jurisdiction: "Canada",
        ratePpm: 50_000,
        appliesToShipping: true,
      },
      OWNER,
    );
    await Promise.all([
      addTaxRate.call(
        {
          zoneId: bc.id,
          name: "GST",
          jurisdiction: "Canada",
          ratePpm: 50_000,
          appliesToShipping: true,
          priority: 0,
        },
        OWNER,
      ),
      addTaxRate.call(
        {
          zoneId: bc.id,
          name: "PST",
          jurisdiction: "British Columbia",
          ratePpm: 70_000,
          appliesToShipping: false,
          priority: 10,
        },
        OWNER,
      ),
    ]);

    const quote = await quoteTax.call(
      {
        currency: "CAD",
        contactId: buyer.id,
        origin: { country: "CA", region: "BC", postalCode: "V8V 1V1" },
        destination: { country: "CA", region: "BC", postalCode: "V5K 0A1" },
        items: [
          {
            id: "line:0",
            quantityMicros: 1_000_000,
            unitAmountMinor: 10_000,
            discountMinor: 0,
            category: "standard",
            requiresShipping: true,
          },
        ],
        shippingMinor: 1_000,
      },
      OWNER,
    );
    expect(quote.zone).toMatchObject({ id: bc.id, name: "British Columbia" });
    expect(quote.lines.map((line) => [line.name, line.taxMinor])).toEqual([
      ["GST", 500],
      ["GST", 50],
      ["PST", 700],
    ]);
    expect(quote.totalTaxMinor).toBe(1_250);
    expect(quote.explanation.join(" ")).toContain("line rounding");
  });

  it("applies only a validated, unexpired exemption and explains reverse charge", async () => {
    const buyer = await contact();
    const zone = await createTaxZone.call(
      {
        name: "European Union",
        country: "FR",
        regions: [],
        postalPatterns: [],
        basis: "destination",
        pricesIncludeTax: true,
        roundingScope: "invoice",
        roundingMode: "half_up",
      },
      OWNER,
    );
    await setTaxRegistration.call(
      { zoneId: zone.id, number: "EU123", scheme: "oss", status: "active" },
      OWNER,
    );
    await addTaxRate.call(
      {
        zoneId: zone.id,
        name: "VAT",
        jurisdiction: "France",
        ratePpm: 200_000,
        appliesToShipping: true,
      },
      OWNER,
    );
    const unvalidated = await failure(
      setTaxExemption.call(
        {
          contactId: buyer.id,
          zoneId: zone.id,
          kind: "reverse_charge",
          certificateRef: "FR-NOT-VALIDATED",
          status: "valid",
        },
        OWNER,
      ),
    );
    expect(unvalidated).toMatchObject({ code: "validation" });
    await setTaxExemption.call(
      {
        contactId: buyer.id,
        zoneId: zone.id,
        kind: "reverse_charge",
        certificateRef: "FR-B2B",
        validatedAt: new Date("2026-01-01T00:00:00Z"),
        expiresAt: new Date("2027-01-01T00:00:00Z"),
        status: "valid",
      },
      OWNER,
    );
    const quote = await quoteTax.call(
      {
        currency: "EUR",
        contactId: buyer.id,
        origin: { country: "DE" },
        destination: { country: "FR" },
        items: [
          {
            id: "service",
            quantityMicros: 1_000_000,
            unitAmountMinor: 12_000,
            discountMinor: 0,
            category: "standard",
            requiresShipping: false,
          },
        ],
        occurredAt: new Date("2026-08-14T12:00:00Z"),
      },
      OWNER,
    );
    expect(quote.totalTaxMinor).toBe(0);
    expect(quote.exemption).toMatchObject({ kind: "reverse_charge" });
    expect(quote.explanation[0]).toContain("reverse charge");
  });

  it("keeps issued tax evidence immutable and explains it after configured rates change", async () => {
    const buyer = await contact();
    const zone = await createTaxZone.call(
      {
        name: "British Columbia",
        country: "CA",
        regions: ["BC"],
        postalPatterns: [],
        basis: "destination",
        pricesIncludeTax: false,
        roundingScope: "line",
        roundingMode: "half_up",
      },
      OWNER,
    );
    await setTaxRegistration.call(
      { zoneId: zone.id, number: "GST-BC", thresholdMinor: 0, status: "active" },
      OWNER,
    );
    const gst = await addTaxRate.call(
      {
        zoneId: zone.id,
        name: "GST",
        jurisdiction: "Canada",
        ratePpm: 50_000,
        appliesToShipping: true,
      },
      OWNER,
    );
    await addTaxRate.call(
      {
        zoneId: zone.id,
        name: "PST",
        jurisdiction: "British Columbia",
        ratePpm: 70_000,
        appliesToShipping: false,
      },
      OWNER,
    );
    const tax = {
      mode: "calculate" as const,
      origin: { country: "CA", region: "BC" },
      destination: { country: "CA", region: "BC" },
    };
    const first = await createDraftInvoice.call(
      { ...draftInput(buyer.id, "tax-snapshot:first"), tax },
      OWNER,
    );
    await issueInvoice.call({ id: first.invoice.id }, OWNER);
    expect(first.invoice.taxMinor).toBe(1_200);
    expect(first.taxLines.map((line) => [line.rateName, line.ratePpm, line.amountMinor])).toEqual([
      ["GST", 50_000, 500],
      ["PST", 70_000, 700],
    ]);
    expect(first.taxLines.every((line) => line.registrationNumber === "GST-BC")).toBe(true);
    expect(first.taxLines.every((line) => line.explanation.includes("line rounding"))).toBe(true);

    await db().update(taxRates).set({ ratePpm: 60_000 }).where(eq(taxRates.id, gst.id));
    const second = await createDraftInvoice.call(
      { ...draftInput(buyer.id, "tax-snapshot:second"), tax },
      OWNER,
    );
    expect(second.invoice.taxMinor).toBe(1_300);
    const frozen = await getInvoice.call({ id: first.invoice.id }, OWNER);
    expect(frozen.invoice.taxMinor).toBe(1_200);
    expect(frozen.taxLines.map((line) => line.ratePpm)).toEqual([50_000, 70_000]);
    expect(await db().select().from(taxLines).where(eq(taxLines.invoiceId, first.invoice.id))).toHaveLength(2);
  });

  it("installs a source-attributed template once, monitors by default, and interlocks collection", async () => {
    const catalog = await listTaxTemplates.call({ group: "canada" }, OWNER);
    expect(catalog.templates).toHaveLength(13);
    expect(catalog.warning).toContain("non-collecting");

    const first = await installTaxTemplate.call(
      { key: "ca-qc", thresholdMinor: 3_000_000, thresholdCurrency: "CAD" },
      OWNER,
    );
    const repeated = await installTaxTemplate.call(
      { key: "ca-qc", thresholdMinor: 9_000_000, thresholdCurrency: "CAD" },
      OWNER,
    );
    expect(first).toMatchObject({
      created: true,
      zone: { country: "CA", regions: ["QC"], templateKey: "ca-qc", templateVersion: 1 },
      registration: { status: "monitoring", thresholdMinor: 3_000_000 },
    });
    expect(first.rates.map((rate) => [rate.name, rate.ratePpm])).toEqual([
      ["GST", 50_000],
      ["QST", 99_750],
    ]);
    expect(repeated).toMatchObject({ created: false, zone: { id: first.zone.id } });
    expect(await db().select().from(taxZones)).toHaveLength(1);
    expect(await db().select().from(taxRates)).toHaveLength(2);
    expect(await db().select().from(taxRegistrations)).toHaveLength(1);
    if (!first.registration) throw new Error("new template did not create its monitoring registration");

    const blocked = await failure(
      setTaxRegistration.call(
        { id: first.registration.id, zoneId: first.zone.id, number: "QC-123", status: "active" },
        OWNER,
      ),
    );
    expect(blocked).toMatchObject({ code: "validation" });
    expect(blocked.message).toContain("Review required");
    await expect(
      setTaxRegistration.call(
        {
          id: first.registration.id,
          zoneId: first.zone.id,
          number: "QC-123",
          status: "active",
          acknowledgeTemplateLimitations: true,
        },
        OWNER,
      ),
    ).resolves.toMatchObject({
      status: "active",
      number: "QC-123",
      thresholdMinor: 3_000_000,
      thresholdCurrency: "CAD",
    });
  });

  it("tracks threshold progress in one currency without hiding excluded sales", async () => {
    const installed = await installTaxTemplate.call(
      { key: "ca-bc", thresholdMinor: 20_000, thresholdCurrency: "CAD" },
      OWNER,
    );
    const buyer = await contact();
    for (const [key, amountMinor, invoiceCurrency] of [
      ["one", 9_000, "CAD"],
      ["two", 8_000, "CAD"],
      ["other-currency", 50_000, "USD"],
    ] as const) {
      const draft = await createDraftInvoice.call(
        {
          ...draftInput(buyer.id, `threshold:${key}`, amountMinor),
          currency: invoiceCurrency,
          tax: {
            mode: "calculate",
            origin: { country: "CA", region: "BC" },
            destination: { country: "CA", region: "BC" },
          },
        },
        OWNER,
      );
      expect(draft.invoice).toMatchObject({ taxZoneId: installed.zone.id, taxMinor: 0 });
      expect(draft.invoice.requiredTaxLegend).toContain("no active collection registration");
      await issueInvoice.call({ id: draft.invoice.id }, OWNER);
    }
    const report = await listTaxThresholds.call(
      { asOf: new Date("2026-12-31T23:59:59Z"), window: "calendar_year" },
      OWNER,
    );
    expect(report.thresholds).toMatchObject([
      {
        state: "approaching",
        grossSalesMinor: 17_000,
        refundsMinor: 0,
        transactions: 2,
        remainingMinor: 3_000,
        progressPpm: 850_000,
        totalsByCurrency: [
          { currency: "CAD", grossSalesMinor: 17_000, transactions: 2 },
          { currency: "USD", grossSalesMinor: 50_000, transactions: 1 },
        ],
      },
    ]);
  });
});

describe.runIf(hasDatabase)("the invoice and payment state machines", () => {
  beforeEach(truncateSpine);

  it("creates one deterministic draft, freezes it under a gapless number, and records state evidence", async () => {
    const buyer = await contact();
    const input = draftInput(buyer.id, "invoice:first");
    const first = await createDraftInvoice.call(input, OWNER);
    const repeated = await createDraftInvoice.call(input, OWNER);
    expect(repeated.invoice.id).toBe(first.invoice.id);
    expect(first.invoice).toMatchObject({
      status: "draft",
      subtotalMinor: 10_000,
      taxMinor: 0,
      totalMinor: 10_000,
    });
    expect(first.lines).toHaveLength(1);
    expect(first.invoice.requiredTaxLegend).toContain("No collection obligation");
    const conflict = await failure(
      createDraftInvoice.call(draftInput(buyer.id, "invoice:first", 10_001), OWNER),
    );
    expect(conflict.code).toBe("conflict");

    const issued = await issueInvoice.call({ id: first.invoice.id }, OWNER);
    expect(issued.invoice).toMatchObject({ status: "sent", number: "INV-000001" });
    await expect(issueInvoice.call({ id: first.invoice.id }, OWNER)).resolves.toMatchObject({
      invoice: { number: "INV-000001" },
    });
    const events = await db()
      .select()
      .from(moneyStateEvents)
      .where(eq(moneyStateEvents.subjectId, first.invoice.id));
    expect(events.map((event) => [event.fromState, event.toState])).toEqual([
      [null, "draft"],
      ["draft", "sent"],
    ]);
  });

  it("allocates consecutive numbers transactionally under concurrent issue calls", async () => {
    const buyer = await contact();
    const drafts = await Promise.all(
      ["a", "b", "c", "d"].map((key) =>
        createDraftInvoice.call(draftInput(buyer.id, `invoice:${key}`), OWNER),
      ),
    );
    const issued = await Promise.all(
      drafts.map((draft) => issueInvoice.call({ id: draft.invoice.id }, OWNER)),
    );
    expect(issued.map((row) => row.invoice.number).sort()).toEqual([
      "INV-000001",
      "INV-000002",
      "INV-000003",
      "INV-000004",
    ]);
    const [sequence] = await db().select().from(invoiceSequences);
    expect(sequence?.nextValue).toBe(5);
  });

  it("converges partial and multi-payments, refunds, and invoice status atomically", async () => {
    const buyer = await contact();
    const draft = await createDraftInvoice.call(draftInput(buyer.id, "invoice:paid"), OWNER);
    await issueInvoice.call({ id: draft.invoice.id }, OWNER);
    const first = await createPayment.call(
      {
        invoiceId: draft.invoice.id,
        provider: "manual",
        method: "bank_transfer",
        amountMinor: 6_000,
        idempotencyKey: "payment:first",
      },
      OWNER,
    );
    const second = await createPayment.call(
      {
        invoiceId: draft.invoice.id,
        provider: "manual",
        method: "cash",
        amountMinor: 4_000,
        idempotencyKey: "payment:second",
      },
      OWNER,
    );
    await settlePayment.call({ id: first.id, providerRef: "manual:first" }, OWNER);
    expect((await getInvoice.call({ id: draft.invoice.id }, OWNER)).invoice).toMatchObject({
      status: "partially_paid",
      paidMinor: 6_000,
    });
    await settlePayment.call({ id: second.id, providerRef: "manual:second" }, OWNER);
    expect((await getInvoice.call({ id: draft.invoice.id }, OWNER)).invoice).toMatchObject({
      status: "paid",
      paidMinor: 10_000,
    });

    const firstRefund = await createRefund.call(
      {
        paymentId: first.id,
        amountMinor: 1_000,
        idempotencyKey: "refund:first",
        reason: "Customer accommodation",
      },
      OWNER,
    );
    await settleRefund.call({ id: firstRefund.id, providerRef: "refund:first" }, OWNER);
    expect((await getInvoice.call({ id: draft.invoice.id }, OWNER)).invoice).toMatchObject({
      status: "paid",
      refundedMinor: 1_000,
    });
    const remainingFirst = await createRefund.call(
      {
        paymentId: first.id,
        amountMinor: 5_000,
        idempotencyKey: "refund:first:rest",
        reason: "Return remainder",
      },
      OWNER,
    );
    await settleRefund.call({ id: remainingFirst.id, providerRef: "refund:first:rest" }, OWNER);
    const secondRefund = await createRefund.call(
      {
        paymentId: second.id,
        amountMinor: 4_000,
        idempotencyKey: "refund:second",
        reason: "Return final payment",
      },
      OWNER,
    );
    await settleRefund.call({ id: secondRefund.id, providerRef: "refund:second" }, OWNER);
    expect((await getInvoice.call({ id: draft.invoice.id }, OWNER)).invoice).toMatchObject({
      status: "refunded",
      paidMinor: 10_000,
      refundedMinor: 10_000,
    });
    expect(await db().select().from(refunds)).toHaveLength(3);
  });

  it("lets only one competing full-balance payment settle", async () => {
    const buyer = await contact();
    const draft = await createDraftInvoice.call(draftInput(buyer.id, "invoice:race"), OWNER);
    await issueInvoice.call({ id: draft.invoice.id }, OWNER);
    const attempts = await Promise.all(
      ["one", "two"].map((key) =>
        createPayment.call(
          {
            invoiceId: draft.invoice.id,
            provider: "manual",
            method: "bank_transfer",
            amountMinor: 10_000,
            idempotencyKey: `payment:${key}`,
          },
          OWNER,
        ),
      ),
    );
    const settled = await Promise.allSettled(
      attempts.map((payment, index) =>
        settlePayment.call(
          { id: payment.id, providerRef: `manual:race:${index}` },
          OWNER,
        ),
      ),
    );
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((result) => result.status === "rejected")).toHaveLength(1);
    const [invoice] = await db().select().from(invoices).where(eq(invoices.id, draft.invoice.id));
    expect(invoice).toMatchObject({ status: "paid", paidMinor: 10_000 });
    expect((await db().select().from(payments)).filter((payment) => payment.status === "succeeded")).toHaveLength(1);
  });

  it("cancels unsettled attempts, releases refund reservations, and reconciles a receipt", async () => {
    const buyer = await contact();
    const draft = await createDraftInvoice.call(draftInput(buyer.id, "invoice:cancellation"), OWNER);
    await issueInvoice.call({ id: draft.invoice.id }, OWNER);
    const abandoned = await createPayment.call(
      {
        invoiceId: draft.invoice.id,
        provider: "manual",
        method: "bank_transfer",
        amountMinor: 10_000,
        idempotencyKey: "payment:abandoned",
      },
      OWNER,
    );
    await expect(
      cancelPayment.call({ id: abandoned.id, reason: "Customer chose another method" }, OWNER),
    ).resolves.toMatchObject({ status: "cancelled" });
    expect(
      await failure(settlePayment.call({ id: abandoned.id, providerRef: "impossible" }, OWNER)),
    ).toMatchObject({ code: "conflict" });

    const paid = await createPayment.call(
      {
        invoiceId: draft.invoice.id,
        provider: "manual",
        method: "cash",
        amountMinor: 10_000,
        idempotencyKey: "payment:replacement",
      },
      OWNER,
    );
    await settlePayment.call({ id: paid.id, providerRef: "manual:replacement" }, OWNER);
    const abandonedRefund = await createRefund.call(
      {
        paymentId: paid.id,
        amountMinor: 10_000,
        idempotencyKey: "refund:abandoned",
        reason: "Started in error",
      },
      OWNER,
    );
    await expect(
      cancelRefund.call({ id: abandonedRefund.id, reason: "Refund request withdrawn" }, OWNER),
    ).resolves.toMatchObject({ status: "cancelled" });
    const refund = await createRefund.call(
      {
        paymentId: paid.id,
        amountMinor: 10_000,
        idempotencyKey: "refund:replacement",
        reason: "Full customer return",
      },
      OWNER,
    );
    await settleRefund.call({ id: refund.id, providerRef: "manual:refund:replacement" }, OWNER);

    const receipt = await getPaymentReceipt.call({ paymentId: paid.id }, OWNER);
    expect(receipt).toMatchObject({
      invoice: { id: draft.invoice.id, number: "INV-000001", totalMinor: 10_000 },
      payment: { amountMinor: 10_000, refundedMinor: 10_000, netMinor: 0 },
      customer: { id: buyer.id, email: "ada@example.test" },
    });
    expect(receipt.receiptNumber).toMatch(/^INV-000001-PAY-[A-F0-9]{8}$/);
    expect(receipt.refunds).toHaveLength(1);
    await expect(reconcileMoney.call({}, OWNER)).resolves.toMatchObject({
      balanced: true,
      checked: { invoices: 1, payments: 2, refunds: 2 },
      discrepancies: [],
    });
  });

  it("issues bounded credit notes without mutating the original invoice", async () => {
    const buyer = await contact();
    const draft = await createDraftInvoice.call(draftInput(buyer.id, "invoice:credit"), OWNER);
    const issuedInvoice = await issueInvoice.call({ id: draft.invoice.id }, OWNER);
    const note = await createCreditNote.call(
      {
        invoiceId: draft.invoice.id,
        idempotencyKey: "credit:first",
        reason: "Service adjustment",
        lines: [
          {
            invoiceLineId: issuedInvoice.lines[0]!.id,
            description: "Service adjustment",
            quantityMicros: 1_000_000,
            subtotalMinor: 2_000,
            taxMinor: 0,
          },
        ],
      },
      OWNER,
    );
    const issued = await issueCreditNote.call({ id: note.id }, OWNER);
    expect(issued).toMatchObject({ status: "issued", number: "CN-000001", totalMinor: 2_000 });
    expect((await getInvoice.call({ id: draft.invoice.id }, OWNER)).invoice.totalMinor).toBe(10_000);
    const excessive = await failure(
      createCreditNote.call(
        {
          invoiceId: draft.invoice.id,
          idempotencyKey: "credit:too-much",
          reason: "Impossible credit",
          lines: [
            {
              description: "Too much",
              quantityMicros: 1_000_000,
              subtotalMinor: 9_000,
              taxMinor: 0,
            },
          ],
        },
        OWNER,
      ),
    );
    expect(excessive.code).toBe("validation");
    expect(await db().select().from(creditNotes)).toHaveLength(1);
  });
});

describe.runIf(hasDatabase)("money remains on the contact spine", () => {
  beforeEach(truncateSpine);

  it("repoints and exactly restores invoice and exemption ownership during merge undo", async () => {
    const survivor = await contact("Ada", "ada@example.test");
    const duplicate = await contact("Augusta Ada", "augusta@example.test");
    const zone = await createTaxZone.call(
      {
        name: "British Columbia",
        country: "CA",
        regions: ["BC"],
        postalPatterns: [],
        basis: "destination",
        pricesIncludeTax: false,
        roundingScope: "line",
        roundingMode: "half_up",
      },
      OWNER,
    );
    const exemption = await setTaxExemption.call(
      {
        contactId: duplicate.id,
        zoneId: zone.id,
        kind: "nonprofit",
        status: "pending",
      },
      OWNER,
    );
    const draft = await createDraftInvoice.call(draftInput(duplicate.id, "invoice:merge"), OWNER);
    const merged = await mergeContacts.call(
      { survivingId: survivor.id, duplicateId: duplicate.id },
      OWNER,
    );
    expect((await db().select().from(invoices).where(eq(invoices.id, draft.invoice.id)))[0]?.contactId).toBe(survivor.id);
    expect((await db().select().from(taxExemptions).where(eq(taxExemptions.id, exemption.id)))[0]?.contactId).toBe(survivor.id);

    await undoContactMerge.call({ operationId: merged.mergeOperationId }, OWNER);
    expect((await db().select().from(invoices).where(eq(invoices.id, draft.invoice.id)))[0]?.contactId).toBe(duplicate.id);
    expect((await db().select().from(taxExemptions).where(eq(taxExemptions.id, exemption.id)))[0]?.contactId).toBe(duplicate.id);
    expect(await db().select().from(contacts).where(eq(contacts.id, duplicate.id))).toHaveLength(1);
  });
});

afterAll(closeDb);
