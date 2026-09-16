// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// The column shapes QuickBooks and Xero actually accept (§2535, §43 C9.32).
//
// This file is the whole difference between "a CSV of invoices" and an export.
// Both packages import *sales invoices as lines*, and both compute an invoice's
// total by adding its lines up. So a file that lists only what the customer
// bought produces an invoice in the accounting package that is short by the
// postage, the discount and the tax — a wrong number, imported, in the place a
// business is least able to spot it.
//
// Three rules run through everything below.
//
// **The rows add up to the invoice, exactly.** The reporting module's
// `lines` basis deliberately does not add up to its revenue total (C9.08),
// because spreading an invoice's discount and postage across its items by
// proportion would invent a rounding decision the business never made. An
// accounting export cannot live with that, and does not have to: instead of
// spreading the invoice-level charges it gives them *a row of their own*. The
// identity is integer arithmetic with nothing left over — see `linesFor`.
//
// **Quantity never causes a division.** The platform stores a quantity in
// millionths and amounts in minor units, and both packages compute
// `quantity × rate`. Where those three agree exactly the real quantity is
// written; where they cannot (a fractional quantity, a line discount) the row
// says quantity 1 at the line's net amount and keeps the real quantity in the
// description, where it informs a human and cannot move a total.
//
// **The platform does not invent a chart of accounts.** Account code, tax code
// and item code are the bookkeeper's, carried verbatim.
import { moneyDecimal } from "@/core/i18n";
import { csvFile, data, text, type CsvCell } from "@/core/reporting/csv";
import type { EXPORT_DATE_FORMATS, EXPORT_SHAPES } from "./export-schema";

export type ExportShape = (typeof EXPORT_SHAPES)[number];
export type ExportDateFormat = (typeof EXPORT_DATE_FORMATS)[number];

/** What the file says about the business, beyond the invoices themselves. */
export interface ExportSettings {
  shape: ExportShape;
  dateFormat: ExportDateFormat;
  timezone: string;
  itemCode: string | null;
  accountCode: string | null;
  taxCode: string | null;
}

export interface ExportAddress {
  street1?: string | null;
  street2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

export interface ExportInvoice {
  id: string;
  number: string | null;
  status: string;
  sourceType: string;
  currency: string;
  memo: string | null;
  issuedAt: Date | null;
  dueAt: Date | null;
  paidAt: Date | null;
  subtotalMinor: number;
  discountMinor: number;
  shippingMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  refundedMinor: number;
  contactName: string;
  contactEmail: string | null;
  billingAddress: ExportAddress | null;
}

export interface ExportInvoiceLine {
  invoiceId: string;
  position: number;
  description: string;
  quantityMicros: number;
  unitAmountMinor: number;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
}

/** One row of the file, before it knows which shape it will be written in. */
export interface ExportRow {
  invoice: ExportInvoice;
  /** True for the first row of each invoice, which carries its totals. */
  first: boolean;
  description: string;
  /** Null where a quantity could not be written without a division. */
  quantity: number | null;
  unitAmountMinor: number;
  /** Net of any line discount, excluding tax. */
  amountMinor: number;
  taxMinor: number;
}

const MICROS = 1_000_000;

/**
 * The label for the row that carries what sits on the invoice rather than on
 * any item. Not translated: it is written into a file destined for somebody
 * else's accounting package, where a locale change between two months would
 * look like two different things being sold.
 */
export const CHARGES_DESCRIPTION = "Shipping, tax and other invoice charges";

function sum<T>(items: readonly T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + pick(item), 0);
}

/**
 * One invoice, as rows that add up to it.
 *
 * The last row absorbs everything the item rows cannot carry:
 *
 *   charges = (invoice.subtotal − Σline.subtotal)
 *           − (invoice.discount − Σline.discount)
 *           + invoice.shipping
 *   chargesTax = invoice.tax − Σline.tax
 *
 * Substituting into `Σ(amount) + Σ(tax)` cancels every line term and leaves
 * `subtotal − discount + shipping + tax`, which the `invoices_total_consistent`
 * database check says *is* the invoice total. Integer addition throughout: no
 * proportions, no rounding, and nothing to reconcile afterwards.
 *
 * An invoice with no item rows at all still produces one row, for the same
 * amount, so no money is ever dropped for want of a line to hang it on.
 */
export function linesFor(
  invoice: ExportInvoice,
  lines: readonly ExportInvoiceLine[],
): ExportRow[] {
  const ordered = [...lines].sort((a, b) => a.position - b.position);
  const rows: Omit<ExportRow, "first">[] = [];

  for (const line of ordered) {
    const net = line.subtotalMinor - line.discountMinor;
    const whole = line.quantityMicros % MICROS === 0 ? line.quantityMicros / MICROS : null;
    // Every one of these has to hold, or the pair (quantity, rate) would need
    // a division to reconstruct the amount, and a division is a rounding
    // decision the business never made.
    const exact =
      whole !== null &&
      line.discountMinor === 0 &&
      whole * line.unitAmountMinor === line.subtotalMinor;
    rows.push({
      invoice,
      description: exact ? line.description : describeQuantity(line),
      quantity: exact ? whole : null,
      unitAmountMinor: exact ? line.unitAmountMinor : net,
      amountMinor: net,
      taxMinor: line.taxMinor,
    });
  }

  const chargesMinor =
    invoice.subtotalMinor -
    sum(ordered, (line) => line.subtotalMinor) -
    (invoice.discountMinor - sum(ordered, (line) => line.discountMinor)) +
    invoice.shippingMinor;
  const chargesTaxMinor = invoice.taxMinor - sum(ordered, (line) => line.taxMinor);

  if (chargesMinor !== 0 || chargesTaxMinor !== 0 || rows.length === 0) {
    rows.push({
      invoice,
      description: CHARGES_DESCRIPTION,
      quantity: 1,
      unitAmountMinor: chargesMinor,
      amountMinor: chargesMinor,
      taxMinor: chargesTaxMinor,
    });
  }

  return rows.map((row, index) => ({ ...row, first: index === 0 }));
}

/**
 * A quantity that could not be a column, kept where a person can still read it.
 *
 * `2.5 × Consulting hour` rather than a silent `1`. The number is assembled
 * from the stored millionths by string, not by dividing.
 */
function describeQuantity(line: ExportInvoiceLine): string {
  const whole = Math.trunc(line.quantityMicros / MICROS);
  const fraction = String(line.quantityMicros % MICROS)
    .padStart(6, "0")
    .replace(/0+$/, "");
  const quantity = fraction ? `${whole}.${fraction}` : String(whole);
  return quantity === "1" ? line.description : `${quantity} × ${line.description}`;
}

/** A date as the accounting package's region reads it, or unambiguously. */
export function exportDate(
  at: Date | null,
  format: ExportDateFormat,
  timezone: string,
): string {
  if (!at) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const year = value("year");
  const month = value("month");
  const day = value("day");
  if (format === "dmy") return `${day}/${month}/${year}`;
  if (format === "mdy") return `${month}/${day}/${year}`;
  return `${year}-${month}-${day}`;
}

function address(invoice: ExportInvoice): ExportAddress {
  return invoice.billingAddress ?? {};
}

/* ------------------------------------------------------------- the shapes */

/**
 * Freeholder's own columns, for a person and a spreadsheet.
 *
 * The invoice-level figures appear once per invoice and are blank on its other
 * rows. That is not tidiness: a column that repeats a total on every line adds
 * up to the wrong number the moment somebody drags it into a pivot table, and
 * a blank cell is the difference between a right figure and a plausible wrong
 * one.
 */
const FREEHOLDER_HEADER = [
  "Invoice Number",
  "Invoice Date",
  "Paid Date",
  "Due Date",
  "Status",
  "Raised By",
  "Customer",
  "Customer Email",
  "Currency",
  "Line Description",
  "Quantity",
  "Unit Amount",
  "Line Amount",
  "Line Tax",
  "Line Total",
  "Invoice Total",
  "Invoice Paid",
  "Invoice Refunded",
] as const;

/**
 * QuickBooks Online's invoice import template.
 *
 * The header names, their order and the leading asterisks on the required ones
 * are QuickBooks', not ours — an importer matches on the literal string, so
 * "tidying" `Item(Product/Service)` into `Item (Product/Service)` would break
 * every import. The invoice-level fields repeat on every line, which is how
 * QuickBooks groups lines into one invoice.
 */
const QUICKBOOKS_HEADER = [
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
] as const;

/**
 * Xero's sales invoice import template.
 *
 * Same rule: the literal names in Xero's order, optional columns included and
 * left empty where the platform has nothing to put in them, because a template
 * with the expected shape is the one an owner can hand over without editing.
 *
 * `Discount` is deliberately always blank. Xero's discount column is a
 * *percentage*, and deriving one from integer minor units needs a division
 * that rounds; the platform therefore exports the already-discounted amount
 * and leaves the percentage to nobody.
 */
const XERO_HEADER = [
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
] as const;

export function headerFor(shape: ExportShape): readonly string[] {
  if (shape === "quickbooks") return QUICKBOOKS_HEADER;
  if (shape === "xero") return XERO_HEADER;
  return FREEHOLDER_HEADER;
}

function cellsFor(row: ExportRow, settings: ExportSettings): CsvCell[] {
  const invoice = row.invoice;
  const money = (minor: number) => data(moneyDecimal(minor, invoice.currency));
  const date = (at: Date | null) => data(exportDate(at, settings.dateFormat, settings.timezone));
  const quantity = data(row.quantity ?? 1);
  const total = row.amountMinor + row.taxMinor;

  if (settings.shape === "quickbooks") {
    return [
      data(invoice.number),
      text(invoice.contactName),
      date(invoice.issuedAt),
      date(invoice.dueAt ?? invoice.issuedAt),
      data(""),
      data(""),
      text(invoice.memo),
      text(settings.itemCode),
      text(row.description),
      quantity,
      money(row.unitAmountMinor),
      money(row.amountMinor),
      text(settings.taxCode),
      money(row.taxMinor),
      data(invoice.currency),
    ];
  }

  if (settings.shape === "xero") {
    const where = address(invoice);
    return [
      text(invoice.contactName),
      text(invoice.contactEmail),
      text(where.street1),
      text(where.street2),
      data(""),
      data(""),
      text(where.city),
      text(where.region),
      text(where.postalCode),
      text(where.country),
      data(invoice.number),
      text(invoice.memo),
      date(invoice.issuedAt),
      date(invoice.dueAt ?? invoice.issuedAt),
      text(settings.itemCode),
      text(row.description),
      quantity,
      money(row.unitAmountMinor),
      data(""),
      text(settings.accountCode),
      text(settings.taxCode),
      money(row.taxMinor),
      data(""),
      data(""),
      data(""),
      data(""),
      data(invoice.currency),
      data(""),
    ];
  }

  return [
    data(invoice.number),
    date(invoice.issuedAt),
    date(invoice.paidAt),
    date(invoice.dueAt),
    data(invoice.status),
    data(invoice.sourceType),
    text(invoice.contactName),
    text(invoice.contactEmail),
    data(invoice.currency),
    text(row.description),
    quantity,
    money(row.unitAmountMinor),
    money(row.amountMinor),
    money(row.taxMinor),
    money(total),
    row.first ? money(invoice.totalMinor) : data(""),
    row.first ? money(invoice.paidMinor) : data(""),
    row.first ? money(invoice.refundedMinor) : data(""),
  ];
}

/** The finished file. */
export function buildExportCsv(
  rows: readonly ExportRow[],
  settings: ExportSettings,
): string {
  return csvFile(
    headerFor(settings.shape),
    rows.map((row) => cellsFor(row, settings)),
    // Only the shape a person opens gets a byte-order mark: it saves Excel
    // from mangling an accented customer name, and it would corrupt the first
    // header of a file an importer is parsing.
    { byteOrderMark: settings.shape === "csv" },
  );
}
