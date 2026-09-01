// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Scheduled exports and the accounting shapes (MASTER.md §2535, §43 C9.32).
//
// Three tests matter more than the rest, and they are the three ways this
// feature can be quietly, expensively wrong:
//
//   - the header is the literal one QuickBooks and Xero match on,
//   - two currencies are never added into one figure, and
//   - a delivery that failed is a row rather than a silence.
//
// A fourth is nearly as important and easier to miss: the exported lines must
// add up to the invoice exactly, because both packages total an invoice by
// adding its lines and a file that is short by the postage produces a wrong
// number *inside the accounting system*, where a business is least equipped to
// notice it.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/core/db";
import { users } from "@/core/auth/schema";
import { mailSuppressions } from "@/core/mail/schema";
import { parseCsv } from "@/core/import/csv";
import { csvFile, data, text as textCell } from "@/core/reporting/csv";
import { moneyDecimal } from "@/core/i18n";
import { invoiceLines, invoices } from "@/modules/invoicing/schema";
import { resolveContact } from "@/core/contacts/service";
import { exportRuns } from "@/modules/reporting/export-schema";
import { headerFor, linesFor } from "@/modules/reporting/export-shapes";
import {
  deleteExport,
  deliverExportRun,
  exportFile,
  listExportRuns,
  listExports,
  reclaimExportRuns,
  runExport,
  saveExport,
} from "@/modules/reporting/service";
import { ready } from "@/core/runtime";
import { closeDb, failure, hasDatabase, OWNER, truncateSpine } from "../helpers/spine";

const SYSTEM = { kind: "system" } as const;

let sequence = 0;

/** A date inside "last month", in UTC, whatever month it is today. */
function inPreviousMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 12));
}

async function person(name: string) {
  const { contact } = await resolveContact.call(
    { email: `${name}@example.test`, name },
    OWNER,
  );
  return contact;
}

interface LineSpec {
  description: string;
  quantityMicros: number;
  unitAmountMinor: number;
  subtotalMinor: number;
  discountMinor?: number;
  taxMinor?: number;
}

/**
 * One issued, paid invoice with lines, written straight to the tables.
 *
 * Deliberately not through the invoicing service: the point of these tests is
 * what the exporter does with an invoice's *shape*, including the awkward ones
 * (a fractional quantity, a line discount, postage) that a happy-path fixture
 * would never produce.
 */
async function invoice(options: {
  contactId: string;
  currency: string;
  at: Date;
  lines: LineSpec[];
  shippingMinor?: number;
  invoiceTaxMinor?: number;
  refundedMinor?: number;
  paid?: boolean;
  billingAddress?: Record<string, string>;
}) {
  sequence += 1;
  const lines = options.lines.map((line, index) => ({
    ...line,
    position: index,
    discountMinor: line.discountMinor ?? 0,
    taxMinor: line.taxMinor ?? 0,
  }));
  const subtotalMinor = lines.reduce((sum, line) => sum + line.subtotalMinor, 0);
  const discountMinor = lines.reduce((sum, line) => sum + line.discountMinor, 0);
  const shippingMinor = options.shippingMinor ?? 0;
  const taxMinor =
    options.invoiceTaxMinor ?? lines.reduce((sum, line) => sum + line.taxMinor, 0);
  const totalMinor = subtotalMinor - discountMinor + shippingMinor + taxMinor;
  const paid = options.paid ?? true;

  const [created] = await db()
    .insert(invoices)
    .values({
      contactId: options.contactId,
      number: `INV-${sequence}`,
      sequenceKey: "default",
      idempotencyKey: `export-test-${sequence}`,
      requestHash: String(sequence).padStart(64, "0"),
      currency: options.currency,
      status: paid ? "paid" : "sent",
      subtotalMinor,
      discountMinor,
      shippingMinor,
      taxMinor,
      totalMinor,
      paidMinor: paid ? totalMinor : 0,
      refundedMinor: options.refundedMinor ?? 0,
      billingAddress: options.billingAddress ?? null,
      issuedAt: options.at,
      dueAt: options.at,
      paidAt: paid ? options.at : null,
    })
    .returning();

  for (const line of lines) {
    await db()
      .insert(invoiceLines)
      .values({
        invoiceId: created!.id,
        position: line.position,
        description: line.description,
        quantityMicros: line.quantityMicros,
        unitAmountMinor: line.unitAmountMinor,
        subtotalMinor: line.subtotalMinor,
        discountMinor: line.discountMinor,
        taxMinor: line.taxMinor,
        totalMinor: line.subtotalMinor - line.discountMinor + line.taxMinor,
      });
  }
  return created!;
}

async function defineExport(options: {
  name: string;
  shape: "csv" | "quickbooks" | "xero";
  currency: string;
  recipients?: string[];
  scheduled?: boolean;
  basis?: "paid" | "issued";
  accountCode?: string | null;
  taxCode?: string | null;
}) {
  return saveExport.call(
    {
      name: options.name,
      shape: options.shape,
      currency: options.currency,
      period: "previous_month",
      timezone: "UTC",
      basis: options.basis ?? "paid",
      scheduled: options.scheduled ?? false,
      recipients: options.recipients ?? [],
      accountCode: options.accountCode ?? (options.shape === "xero" ? "200" : null),
      taxCode: options.taxCode ?? (options.shape === "xero" ? "Tax on Sales" : null),
      itemCode: "SALES",
    },
    OWNER,
  );
}

/** The file as rows, header separated. */
async function fileOf(runId: string) {
  const file = await exportFile.call({ runId }, OWNER);
  const rows = parseCsv(file.csv).filter((row) => row.some((cell) => cell !== ""));
  return { filename: file.filename, header: rows[0]!, body: rows.slice(1) };
}

/* -------------------------------------------------- shapes, without a database */

describe("the accounting column shapes", () => {
  // The literal strings both importers match on. Written out here rather than
  // imported from the code under test on purpose: a gate that consults the
  // answer key proves nothing, and "tidying" a header name is exactly the kind
  // of harmless-looking edit that breaks every import silently.
  it("is QuickBooks' invoice import template, verbatim", () => {
    expect(headerFor("quickbooks")).toEqual([
      "*InvoiceNo",
      "*Customer",
      "*InvoiceDate",
      "*DueDate",
      "Terms",
      "Location",
      "Memo",
      "Item(Product/Service)",
      "ItemDescription",
      "ItemQuantity",
      "ItemRate",
      "*ItemAmount",
      "*ItemTaxCode",
      "ItemTaxAmount",
      "Currency",
    ]);
  });

  it("is Xero's sales invoice import template, verbatim", () => {
    expect(headerFor("xero")).toEqual([
      "*ContactName",
      "EmailAddress",
      "POAddressLine1",
      "POAddressLine2",
      "POAddressLine3",
      "POAddressLine4",
      "POCity",
      "PORegion",
      "POPostalCode",
      "POCountry",
      "*InvoiceNumber",
      "Reference",
      "*InvoiceDate",
      "*DueDate",
      "InventoryItemCode",
      "*Description",
      "*Quantity",
      "*UnitAmount",
      "Discount",
      "*AccountCode",
      "*TaxType",
      "TaxAmount",
      "TrackingName1",
      "TrackingOption1",
      "TrackingName2",
      "TrackingOption2",
      "Currency",
      "BrandingTheme",
    ]);
  });

  it("gives the invoice's own charges a row rather than spreading them", () => {
    // Two items, a discount on one, postage and more tax than the lines carry.
    // Every one of those is a place a naive exporter loses money.
    const base = {
      id: "i1",
      number: "INV-1",
      status: "paid",
      sourceType: "order",
      currency: "CAD",
      memo: null,
      issuedAt: new Date(),
      dueAt: null,
      paidAt: new Date(),
      contactName: "Buyer",
      contactEmail: null,
      billingAddress: null,
    };
    const invoiceRow = {
      ...base,
      subtotalMinor: 10_000,
      discountMinor: 1_500,
      shippingMinor: 900,
      taxMinor: 1_200,
      totalMinor: 10_000 - 1_500 + 900 + 1_200,
      paidMinor: 10_600,
      refundedMinor: 0,
    };
    const rows = linesFor(invoiceRow, [
      {
        invoiceId: "i1",
        position: 0,
        description: "Widget",
        quantityMicros: 2_000_000,
        unitAmountMinor: 3_000,
        subtotalMinor: 6_000,
        discountMinor: 1_500,
        taxMinor: 500,
      },
      {
        invoiceId: "i1",
        position: 1,
        description: "Gadget",
        quantityMicros: 1_000_000,
        unitAmountMinor: 4_000,
        subtotalMinor: 4_000,
        discountMinor: 0,
        taxMinor: 400,
      },
    ]);

    const total = rows.reduce((sum, each) => sum + each.amountMinor + each.taxMinor, 0);
    expect(total).toBe(invoiceRow.totalMinor);
    // The postage and the tax the lines did not carry are one extra row, not a
    // proportion smeared across the items.
    expect(rows).toHaveLength(3);
    expect(rows[2]!.amountMinor).toBe(900);
    expect(rows[2]!.taxMinor).toBe(1_200 - 900);
  });

  it("never pairs a quantity with a rate that needs a division", () => {
    const base = {
      id: "i2",
      number: "INV-2",
      status: "paid",
      sourceType: "booking",
      currency: "CAD",
      memo: null,
      issuedAt: new Date(),
      dueAt: null,
      paidAt: new Date(),
      contactName: "Client",
      contactEmail: null,
      billingAddress: null,
      subtotalMinor: 3_750,
      discountMinor: 0,
      shippingMinor: 0,
      taxMinor: 0,
      totalMinor: 3_750,
      paidMinor: 3_750,
      refundedMinor: 0,
    };
    // 2.5 hours at 15.00. The package would compute 2.5 × 1500 correctly, but
    // a line with a discount could not be reconstructed, so the rule is one
    // rule: quantity 1 at the net amount, real quantity in the description.
    const [fractional] = linesFor(base, [
      {
        invoiceId: "i2",
        position: 0,
        description: "Consulting hour",
        quantityMicros: 2_500_000,
        unitAmountMinor: 1_500,
        subtotalMinor: 3_750,
        discountMinor: 0,
        taxMinor: 0,
      },
    ]);
    expect(fractional!.quantity).toBeNull();
    expect(fractional!.unitAmountMinor).toBe(3_750);
    expect(fractional!.description).toBe("2.5 × Consulting hour");

    // A whole quantity whose arithmetic is exact keeps its quantity.
    const [whole] = linesFor({ ...base, subtotalMinor: 3_000, totalMinor: 3_000, paidMinor: 3_000 }, [
      {
        invoiceId: "i2",
        position: 0,
        description: "Print",
        quantityMicros: 2_000_000,
        unitAmountMinor: 1_500,
        subtotalMinor: 3_000,
        discountMinor: 0,
        taxMinor: 0,
      },
    ]);
    expect(whole!.quantity).toBe(2);
    expect(whole!.unitAmountMinor).toBe(1_500);
    expect(whole!.description).toBe("Print");
  });

  it("defuses a formula in a name without defusing a negative amount", () => {
    // A customer called `=HYPERLINK(...)` executes on the accountant's machine
    // if the cell is not defused; a refund written `'-12.34` stops being a
    // number if it is. The cell type is what keeps both true at once.
    const file = csvFile(
      ["Customer", "Amount"],
      [[textCell("=HYPERLINK(\"http://evil\")"), data(moneyDecimal(-1_234, "CAD"))]],
    );
    const [, row] = parseCsv(file);
    expect(row![0]).toBe("'=HYPERLINK(\"http://evil\")");
    expect(row![1]).toBe("-12.34");
  });

  it("writes money as an exact decimal without dividing", () => {
    expect(moneyDecimal(1, "CAD")).toBe("0.01");
    expect(moneyDecimal(-1_234_567, "CAD")).toBe("-12345.67");
    // Three minor digits, because "cents" is a two-decimal assumption most of
    // the world does not share.
    expect(moneyDecimal(1_000, "KWD")).toBe("1.000");
    expect(moneyDecimal(1_000, "JPY")).toBe("1000");
  });
});

/* --------------------------------------------------------- with a database */

describe.runIf(hasDatabase)("scheduled accounting exports", () => {
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

  it("never puts two currencies in one file, and says which it left out", async () => {
    // §4.9 forbids converting at charge time. A file that carried CAD and EUR
    // rows under one total would be converting with extra steps and handing
    // the result to an accountant as fact.
    const buyer = await person("mixed");
    const at = inPreviousMonth();
    await invoice({
      contactId: buyer.id,
      currency: "CAD",
      at,
      lines: [{ description: "Canadian work", quantityMicros: 1_000_000, unitAmountMinor: 10_000, subtotalMinor: 10_000 }],
    });
    await invoice({
      contactId: buyer.id,
      currency: "EUR",
      at,
      lines: [{ description: "European work", quantityMicros: 1_000_000, unitAmountMinor: 5_000, subtotalMinor: 5_000 }],
    });

    const definition = await defineExport({ name: "Books", shape: "csv", currency: "CAD" });
    const run = await runExport.call({ id: definition.id }, OWNER);

    expect(run.currency).toBe("CAD");
    expect(run.invoiceCount).toBe(1);
    expect(run.totalMinor).toBe(10_000);
    // The EUR invoice is not in the total, not in the file, and not silently
    // gone either: the run says what was left out and why it had to be.
    expect(run.excludedCurrencies).toEqual(["EUR"]);
    expect(run.excludedInvoiceCount).toBe(1);

    const file = await fileOf(run.id);
    expect(file.body).toHaveLength(1);
    expect(file.body.every((row) => row.includes("CAD"))).toBe(true);
    expect(file.body.some((row) => row.includes("EUR"))).toBe(false);
    expect(file.filename).toContain("CAD");
  });

  it("exports lines that add up to the invoice exactly", async () => {
    const buyer = await person("adds-up");
    const created = await invoice({
      contactId: buyer.id,
      currency: "CAD",
      at: inPreviousMonth(),
      shippingMinor: 900,
      invoiceTaxMinor: 1_200,
      lines: [
        { description: "Widget", quantityMicros: 2_000_000, unitAmountMinor: 3_000, subtotalMinor: 6_000, discountMinor: 1_500, taxMinor: 500 },
        { description: "Gadget", quantityMicros: 1_000_000, unitAmountMinor: 4_000, subtotalMinor: 4_000, taxMinor: 400 },
      ],
    });

    const definition = await defineExport({ name: "QuickBooks", shape: "quickbooks", currency: "CAD" });
    const run = await runExport.call({ id: definition.id }, OWNER);
    const file = await fileOf(run.id);

    // *ItemAmount and ItemTaxAmount are the eleventh and thirteenth columns.
    const amount = file.header.indexOf("*ItemAmount");
    const tax = file.header.indexOf("ItemTaxAmount");
    const cents = (value: string) => Math.round(Number(value) * 100);
    const total = file.body.reduce(
      (sum, row) => sum + cents(row[amount]!) + cents(row[tax]!),
      0,
    );
    expect(total).toBe(created.totalMinor);
    expect(file.body).toHaveLength(3);
  });

  it("carries the bookkeeper's codes and refuses to invent them", async () => {
    const buyer = await person("xero");
    await invoice({
      contactId: buyer.id,
      currency: "CAD",
      at: inPreviousMonth(),
      billingAddress: { street1: "1 Main St", city: "Victoria", region: "BC", postalCode: "V8W", country: "CA" },
      lines: [{ description: "Session", quantityMicros: 1_000_000, unitAmountMinor: 20_000, subtotalMinor: 20_000 }],
    });

    // Xero rejects a line with no account code and no tax type, so the
    // platform refuses to save an export that would produce one — without ever
    // guessing what the code should be.
    const refused = await failure(
      saveExport.call(
        {
          name: "Incomplete Xero",
          shape: "xero",
          currency: "CAD",
          period: "previous_month",
          timezone: "UTC",
          recipients: [],
          accountCode: null,
          taxCode: null,
        },
        OWNER,
      ),
    );
    expect(refused.code).toBe("validation");
    expect(refused.message).toContain("account code");

    const definition = await defineExport({ name: "Xero", shape: "xero", currency: "CAD" });
    const run = await runExport.call({ id: definition.id }, OWNER);
    const file = await fileOf(run.id);
    const at = (name: string) => file.body[0]![file.header.indexOf(name)];

    expect(at("*AccountCode")).toBe("200");
    expect(at("*TaxType")).toBe("Tax on Sales");
    expect(at("InventoryItemCode")).toBe("SALES");
    expect(at("POCity")).toBe("Victoria");
    // Xero's Discount column is a percentage. Deriving one from integer minor
    // units needs a division that rounds, so it stays empty and the amount is
    // already net.
    expect(at("Discount")).toBe("");
  });

  it("records a failed delivery rather than losing it, and keeps the file", async () => {
    const buyer = await person("failing");
    await invoice({
      contactId: buyer.id,
      currency: "CAD",
      at: inPreviousMonth(),
      lines: [{ description: "Work", quantityMicros: 1_000_000, unitAmountMinor: 4_500, subtotalMinor: 4_500 }],
    });
    // A hard bounce on file. `sendMail` refuses a suppressed address, which is
    // the most realistic way a monthly delivery stops arriving.
    await db().insert(mailSuppressions).values({
      email: "bookkeeper@example.test",
      reason: "hard_bounce",
      provider: "ses",
    });

    const definition = await defineExport({
      name: "Monthly books",
      shape: "csv",
      currency: "CAD",
      recipients: ["bookkeeper@example.test"],
      scheduled: true,
    });

    const built = await runExport.call({ id: definition.id, trigger: "schedule" }, OWNER);
    expect(built.status).toBe("pending");

    const settled = await deliverExportRun.call({ runId: built.id }, OWNER);
    expect(settled.status).toBe("failed");
    expect(settled.deliveredCount).toBe(0);
    expect(settled.deliveredAt).toBeNull();
    expect(settled.failedAt).not.toBeNull();
    expect(settled.error).toContain("bookkeeper@example.test");
    expect(settled.attempts).toBe(1);

    // The file survives the failed delivery: a report that did not send is
    // late, not lost, and the owner can hand it over themselves.
    const file = await fileOf(built.id);
    expect(file.body).toHaveLength(1);

    // And the screen can see it without being told: the run is on the list.
    const listed = await listExports.call({}, OWNER);
    expect(listed[0]!.lastRun!.status).toBe("failed");
    const history = await listExportRuns.call({ id: definition.id }, OWNER);
    expect(history).toHaveLength(1);
  });

  it("will not call an undeliverable adapter a delivery", async () => {
    // The default transactional adapter is the console sink: it accepts a
    // message and discards it. Marking that delivered would put a green tick
    // on a report that reaches nobody, month after month.
    const buyer = await person("console");
    await invoice({
      contactId: buyer.id,
      currency: "CAD",
      at: inPreviousMonth(),
      lines: [{ description: "Work", quantityMicros: 1_000_000, unitAmountMinor: 1_000, subtotalMinor: 1_000 }],
    });
    const definition = await defineExport({
      name: "To the void",
      shape: "csv",
      currency: "CAD",
      recipients: ["accounts@example.test"],
      scheduled: true,
    });
    const built = await runExport.call({ id: definition.id }, OWNER);
    const settled = await deliverExportRun.call({ runId: built.id }, OWNER);

    expect(settled.status).toBe("failed");
    expect(settled.error).toContain("no delivering mail adapter");
  });

  it("reclaims a delivery that stopped part-way, and leaves a fresh one alone", async () => {
    const buyer = await person("stalled");
    await invoice({
      contactId: buyer.id,
      currency: "CAD",
      at: inPreviousMonth(),
      lines: [{ description: "Work", quantityMicros: 1_000_000, unitAmountMinor: 2_500, subtotalMinor: 2_500 }],
    });
    const definition = await defineExport({
      name: "Crashy",
      shape: "csv",
      currency: "CAD",
      recipients: ["accounts@example.test"],
      scheduled: true,
    });
    const built = await runExport.call({ id: definition.id }, OWNER);

    // A run that has only just started is still going, and must not be
    // declared dead by a sweep that happens to run a second later.
    expect((await reclaimExportRuns.call({}, SYSTEM)).reclaimed).toBe(0);

    // The transaction that was delivering it died: nothing wrote an outcome,
    // and nothing in that transaction could have.
    await db()
      .update(exportRuns)
      .set({ startedAt: sql`now() - interval '2 hours'` })
      .where(eq(exportRuns.id, built.id));

    expect((await reclaimExportRuns.call({}, SYSTEM)).reclaimed).toBe(1);
    const [after] = await db().select().from(exportRuns).where(eq(exportRuns.id, built.id));
    expect(after!.status).toBe("failed");
    expect(after!.error).toContain("never reported an outcome");
  });

  it("asks for a period once, however many times it is asked", async () => {
    const buyer = await person("idempotent");
    await invoice({
      contactId: buyer.id,
      currency: "CAD",
      at: inPreviousMonth(),
      lines: [{ description: "Work", quantityMicros: 1_000_000, unitAmountMinor: 7_000, subtotalMinor: 7_000 }],
    });
    const definition = await defineExport({ name: "Once", shape: "csv", currency: "CAD" });

    const first = await runExport.call({ id: definition.id }, OWNER);
    const second = await runExport.call({ id: definition.id }, OWNER);
    expect(second.id).toBe(first.id);
    expect(await listExportRuns.call({ id: definition.id }, OWNER)).toHaveLength(1);
  });

  it("counts money that arrived or invoices raised, and says which", async () => {
    const buyer = await person("basis");
    const at = inPreviousMonth();
    // Raised last month, still unpaid. Accrual books count it; the bank has
    // not seen it.
    await invoice({
      contactId: buyer.id,
      currency: "CAD",
      at,
      paid: false,
      lines: [{ description: "Owing", quantityMicros: 1_000_000, unitAmountMinor: 9_000, subtotalMinor: 9_000 }],
    });

    const paidBasis = await defineExport({ name: "Bank", shape: "csv", currency: "CAD", basis: "paid" });
    const issuedBasis = await defineExport({ name: "Accrual", shape: "csv", currency: "CAD", basis: "issued" });

    expect((await runExport.call({ id: paidBasis.id }, OWNER)).invoiceCount).toBe(0);
    const accrual = await runExport.call({ id: issuedBasis.id }, OWNER);
    expect(accrual.invoiceCount).toBe(1);
    expect(accrual.basis).toBe("issued");
  });

  it("keeps a refund out of the total instead of writing a credit note", async () => {
    const buyer = await person("refunded");
    await invoice({
      contactId: buyer.id,
      currency: "CAD",
      at: inPreviousMonth(),
      refundedMinor: 2_000,
      lines: [{ description: "Work", quantityMicros: 1_000_000, unitAmountMinor: 8_000, subtotalMinor: 8_000 }],
    });
    const definition = await defineExport({ name: "Refunds", shape: "csv", currency: "CAD" });
    const run = await runExport.call({ id: definition.id }, OWNER);

    // The invoice goes out as it was invoiced — a credit note is bookkeeping,
    // and inventing one is the line this feature does not cross. The refunded
    // figure is reported beside it so the owner knows what to record.
    expect(run.totalMinor).toBe(8_000);
    expect(run.refundedMinor).toBe(2_000);
  });

  it("refuses a schedule that would reach nobody", async () => {
    const refused = await failure(
      saveExport.call(
        {
          name: "Nowhere",
          shape: "csv",
          currency: "CAD",
          period: "previous_month",
          timezone: "UTC",
          scheduled: true,
          recipients: [],
        },
        OWNER,
      ),
    );
    expect(refused.code).toBe("validation");
    expect(refused.message).toContain("recipient");
  });

  it("will not let the database record a delivery to nobody", async () => {
    // The one invariant that must not depend on a code path being right: a row
    // that claims to have been delivered has to name a time and a count.
    const buyer = await person("invariant");
    await invoice({
      contactId: buyer.id,
      currency: "CAD",
      at: inPreviousMonth(),
      lines: [{ description: "Work", quantityMicros: 1_000_000, unitAmountMinor: 100, subtotalMinor: 100 }],
    });
    const definition = await defineExport({ name: "Invariant", shape: "csv", currency: "CAD" });
    const run = await runExport.call({ id: definition.id }, OWNER);

    const refused = await db()
      .update(exportRuns)
      .set({ status: "delivered", deliveredAt: new Date(), deliveredCount: 0 })
      .where(eq(exportRuns.id, run.id))
      .catch((error: unknown) => error);
    // The driver wraps the failure, so the constraint name is on the cause.
    expect(String((refused as { cause?: unknown })?.cause ?? refused)).toContain(
      "export_runs_delivered_consistent",
    );
  });

  it("shows a scheduled export as due until it has actually been delivered", async () => {
    const buyer = await person("due");
    await invoice({
      contactId: buyer.id,
      currency: "CAD",
      at: inPreviousMonth(),
      lines: [{ description: "Work", quantityMicros: 1_000_000, unitAmountMinor: 500, subtotalMinor: 500 }],
    });
    const definition = await defineExport({
      name: "Due one",
      shape: "csv",
      currency: "CAD",
      recipients: ["accounts@example.test"],
      scheduled: true,
    });

    const before = await listExports.call({}, OWNER);
    expect(before[0]!.due).toBe(true);
    // Overdue is due *plus* a day's grace, because a period that closed nine
    // minutes ago is not evidence of anything. Asserted against the run's own
    // period so the test does not itself fail on the first of the month.
    const dayOld = Date.now() - before[0]!.periodTo.getTime() > 24 * 60 * 60 * 1000;
    expect(before[0]!.overdue).toBe(dayOld);

    // Building the file does not settle anything. "Due" means *delivered*, so
    // a run sitting in `pending` leaves the export due and the next sweep
    // tries the delivery again — which is the behaviour that turns a bad hour
    // at the mail provider into a late report rather than a missing month.
    const built = await runExport.call({ id: definition.id }, OWNER);
    expect(built.status).toBe("pending");
    expect((await listExports.call({}, OWNER))[0]!.due).toBe(true);

    await db()
      .update(exportRuns)
      .set({ status: "delivered", deliveredAt: new Date(), deliveredCount: 1 })
      .where(eq(exportRuns.id, built.id));
    const after = await listExports.call({}, OWNER);
    expect(after[0]!.due).toBe(false);
    expect(after[0]!.overdue).toBe(false);

    await deleteExport.call({ id: definition.id }, OWNER);
    expect(await listExports.call({}, OWNER)).toHaveLength(0);
  });
});
