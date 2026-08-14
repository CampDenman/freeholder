// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Transaction-safe invoice, payment, refund, and credit-note state machines.

import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  registerContactReference,
} from "@/core/contacts/service";
import { contacts } from "@/core/contacts/schema";
import { registerContactPrivacySource } from "@/core/privacy/service";
import {
  actorString,
  defineService,
  ServiceError,
  type ServiceContext,
  type Tx,
} from "@/core/service";
import {
  creditNoteLines,
  creditNotes,
  invoiceLines,
  invoiceSequences,
  invoices,
  moneyStateEvents,
  paymentMethods,
  paymentProviderCustomers,
  payments,
  refunds,
  taxExemptions,
  taxLines,
} from "./schema";
import {
  extendMinor,
  subtractMinor,
  sumMinor,
} from "./money";
import { quoteTax } from "./tax-service";
import { allocateSettledPayment } from "./payment-plan-ledger";

const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);
const minor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveMinor = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const quantityMicros = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const idempotencyKey = z.string().trim().min(1).max(240);
const boundedObject = z
  .record(z.string().min(1).max(100), z.unknown())
  .refine((value) => {
    try {
      return JSON.stringify(value).length <= 65_536;
    } catch {
      return false;
    }
  }, "Metadata must be JSON and no larger than 64 KiB.");
const address = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  street1: z.string().trim().min(1).max(300).optional(),
  street2: z.string().trim().max(300).optional(),
  city: z.string().trim().max(200).optional(),
  region: z.string().trim().toUpperCase().max(100).optional(),
  postalCode: z.string().trim().toUpperCase().max(30).optional(),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
});
const taxAddress = address.pick({ city: true, region: true, postalCode: true, country: true });
const lineInput = z.object({
  sourceType: z.string().trim().max(80).optional(),
  sourceId: z.string().trim().max(240).optional(),
  description: z.string().trim().min(1).max(1_000),
  quantityMicros,
  unitAmountMinor: minor,
  discountMinor: minor.default(0),
  taxCategoryCode: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/)
    .max(80)
    .default("standard"),
  requiresShipping: z.boolean().default(false),
  snapshot: boundedObject.default({}),
});
const taxChoice = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("calculate"),
    origin: taxAddress,
    destination: taxAddress,
  }),
  z.object({
    mode: z.literal("not_applicable"),
    reason: z.string().trim().min(3).max(1_000),
  }),
]);

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function requestHash(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

async function lock(tx: Tx, kind: string, id: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${kind}:${id}`}))`);
}

async function stateEvent(
  ctx: ServiceContext,
  subjectType: "invoice" | "payment" | "refund" | "credit_note" | "dispute" | "payment_plan" | "payout",
  subjectId: string,
  fromState: string | null,
  toState: string,
  reason?: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await ctx.tx.insert(moneyStateEvents).values({
    subjectType,
    subjectId,
    fromState,
    toState,
    reason,
    actor: actorString(ctx.actor),
    metadata,
  });
}

async function allocateNumber(
  tx: Tx,
  key: string,
  prefix: string,
): Promise<string> {
  await tx
    .insert(invoiceSequences)
    .values({ key, prefix, nextValue: 1, padding: 6 })
    .onConflictDoNothing();
  const [sequence] = await tx
    .select()
    .from(invoiceSequences)
    .where(eq(invoiceSequences.key, key))
    .for("update");
  if (!sequence) throw new Error(`Invoice sequence ${key} disappeared.`);
  await tx
    .update(invoiceSequences)
    .set({ nextValue: sequence.nextValue + 1 })
    .where(eq(invoiceSequences.key, key));
  return `${sequence.prefix}${String(sequence.nextValue).padStart(sequence.padding, "0")}`;
}

async function invoiceBundle(tx: Tx, id: string) {
  const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!invoice) throw new ServiceError("not_found", "That invoice is not here.");
  const [lines, taxes, invoicePayments, invoiceRefunds, notes] = await Promise.all([
    tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.position)),
    tx.select().from(taxLines).where(eq(taxLines.invoiceId, id)).orderBy(asc(taxLines.priority)),
    tx.select().from(payments).where(eq(payments.invoiceId, id)).orderBy(asc(payments.createdAt)),
    tx.select().from(refunds).where(eq(refunds.invoiceId, id)).orderBy(asc(refunds.createdAt)),
    tx.select().from(creditNotes).where(eq(creditNotes.invoiceId, id)).orderBy(asc(creditNotes.createdAt)),
  ]);
  return { invoice, lines, taxLines: taxes, payments: invoicePayments, refunds: invoiceRefunds, creditNotes: notes };
}

interface PointerRow {
  id: string;
  contactId: string;
}

function registerPointer(
  table: "invoices" | "tax_exemptions" | "payment_provider_customers" | "payment_methods",
  selectRows: (tx: Tx, ids: string[]) => Promise<PointerRow[]>,
  repointRows: (tx: Tx, from: string, to: string) => Promise<unknown>,
): void {
  registerContactReference({
    table,
    repoint: repointRows,
    captureForUndo: async (tx, duplicateId, survivingId) => ({
      state: await selectRows(tx, [duplicateId, survivingId]),
      undoable: true,
    }),
    restoreAfterUndo: async (tx, beforeState, afterState, duplicateId) => {
      const schema = z.array(z.object({ id: z.string().uuid(), contactId: z.string().uuid() }));
      const before = schema.parse(beforeState);
      const after = schema.parse(afterState);
      const current = after.length ? await selectRows(tx, [...new Set(after.map((row) => row.contactId))]) : [];
      const currentById = new Map(current.map((row) => [row.id, row.contactId]));
      if (current.length !== after.length || after.some((row) => currentById.get(row.id) !== row.contactId)) {
        throw new ServiceError(
          "conflict",
          `A ${table.replaceAll("_", " ")} record changed after this merge. Leave the merge in place or restore that record first.`,
        );
      }
      const movedIds = before.filter((row) => row.contactId === duplicateId).map((row) => row.id);
      if (movedIds.length === 0) return;
      if (table === "invoices") {
        await tx.update(invoices).set({ contactId: duplicateId }).where(inArray(invoices.id, movedIds));
      } else if (table === "tax_exemptions") {
        await tx.update(taxExemptions).set({ contactId: duplicateId }).where(inArray(taxExemptions.id, movedIds));
      } else if (table === "payment_provider_customers") {
        await tx.update(paymentProviderCustomers).set({ contactId: duplicateId }).where(inArray(paymentProviderCustomers.id, movedIds));
      } else {
        await tx.update(paymentMethods).set({ contactId: duplicateId }).where(inArray(paymentMethods.id, movedIds));
      }
    },
  });
}

registerPointer(
  "invoices",
  (tx, ids) => tx.select({ id: invoices.id, contactId: invoices.contactId }).from(invoices).where(inArray(invoices.contactId, ids)),
  (tx, from, to) => tx.update(invoices).set({ contactId: to }).where(eq(invoices.contactId, from)),
);
registerPointer(
  "tax_exemptions",
  (tx, ids) => tx.select({ id: taxExemptions.id, contactId: taxExemptions.contactId }).from(taxExemptions).where(inArray(taxExemptions.contactId, ids)),
  (tx, from, to) => tx.update(taxExemptions).set({ contactId: to }).where(eq(taxExemptions.contactId, from)),
);
registerPointer(
  "payment_provider_customers",
  (tx, ids) => tx.select({ id: paymentProviderCustomers.id, contactId: paymentProviderCustomers.contactId }).from(paymentProviderCustomers).where(inArray(paymentProviderCustomers.contactId, ids)),
  (tx, from, to) => tx.update(paymentProviderCustomers).set({ contactId: to }).where(eq(paymentProviderCustomers.contactId, from)),
);
registerPointer(
  "payment_methods",
  (tx, ids) => tx.select({ id: paymentMethods.id, contactId: paymentMethods.contactId }).from(paymentMethods).where(inArray(paymentMethods.contactId, ids)),
  (tx, from, to) => tx.update(paymentMethods).set({ contactId: to }).where(eq(paymentMethods.contactId, from)),
);

registerContactPrivacySource({
  scope: "commerce.money",
  tables: ["invoices", "tax_exemptions", "payment_provider_customers", "payment_methods"],
  exportData: async (tx, contactId) => {
    const owned = await tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.contactId, contactId));
    const ids = owned.map((row) => row.id);
    return {
      invoices: await Promise.all(ids.map((id) => invoiceBundle(tx, id))),
      taxExemptions: await tx.select().from(taxExemptions).where(eq(taxExemptions.contactId, contactId)),
      paymentProviderCustomers: await tx.select().from(paymentProviderCustomers).where(eq(paymentProviderCustomers.contactId, contactId)),
      paymentMethods: await tx.select().from(paymentMethods).where(eq(paymentMethods.contactId, contactId)),
    };
  },
  erase: async (tx, contactId) => {
    const owned = await tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.contactId, contactId));
    const ids = owned.map((row) => row.id);
    let affected = 0;
    if (ids.length) {
      affected += (
        await tx
          .update(invoices)
          .set({ billingAddress: {}, customerTaxId: null, memo: null, schedule: null })
          .where(inArray(invoices.id, ids))
          .returning({ id: invoices.id })
      ).length;
      await tx.update(payments).set({ failureMessage: null, metadata: {} }).where(inArray(payments.invoiceId, ids));
      await tx.update(refunds).set({ failureMessage: null, reason: null }).where(inArray(refunds.invoiceId, ids));
    }
    affected += (
      await tx
        .update(taxExemptions)
        .set({ certificateRef: null, status: "revoked" })
        .where(eq(taxExemptions.contactId, contactId))
        .returning({ id: taxExemptions.id })
    ).length;
    affected += (
      await tx.delete(paymentMethods).where(eq(paymentMethods.contactId, contactId)).returning({ id: paymentMethods.id })
    ).length;
    affected += (
      await tx.delete(paymentProviderCustomers).where(eq(paymentProviderCustomers.contactId, contactId)).returning({ id: paymentProviderCustomers.id })
    ).length;
    return { affected };
  },
});

export const listInvoices = defineService({
  name: "invoicing.list",
  summary: "List invoices by contact or lifecycle state.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    contactId: z.string().uuid().optional(),
    status: z.enum(["draft", "sent", "viewed", "partially_paid", "paid", "overdue", "void", "refunded"]).optional(),
    limit: z.number().int().min(1).max(500).default(100),
  }),
  handler: async (input, ctx) => {
    const filters = [
      input.contactId ? eq(invoices.contactId, input.contactId) : undefined,
      input.status ? eq(invoices.status, input.status) : undefined,
    ].filter((value): value is NonNullable<typeof value> => Boolean(value));
    return ctx.tx
      .select()
      .from(invoices)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(invoices.createdAt))
      .limit(input.limit);
  },
});

export const getInvoice = defineService({
  name: "invoicing.get",
  summary: "Read one invoice with immutable lines, tax evidence, payments, refunds, and credits.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  handler: (input, ctx) => invoiceBundle(ctx.tx, input.id),
});

export const getPaymentReceipt = defineService({
  name: "invoicing.receipt",
  summary: "Build the stable receipt record for one successful payment.",
  kind: "query",
  permission: "scoped",
  input: z.object({ paymentId: z.string().uuid() }),
  handler: async (input, ctx) => {
    const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, input.paymentId)).limit(1);
    if (!payment) throw new ServiceError("not_found", "That payment is not here.");
    if (payment.status !== "succeeded" || !payment.processedAt || !payment.providerRef) {
      throw new ServiceError("conflict", "A receipt exists only after payment succeeds.");
    }
    const bundle = await invoiceBundle(ctx.tx, payment.invoiceId);
    if (!bundle.invoice.number || !bundle.invoice.issuedAt) {
      throw new ServiceError("conflict", "That payment does not belong to an issued invoice.");
    }
    const [customer] = await ctx.tx
      .select({ id: contacts.id, name: contacts.name, email: contacts.email })
      .from(contacts)
      .where(eq(contacts.id, bundle.invoice.contactId))
      .limit(1);
    const paymentRefunds = bundle.refunds.filter(
      (refund) => refund.paymentId === payment.id && refund.status === "succeeded",
    );
    return {
      receiptNumber: `${bundle.invoice.number}-PAY-${payment.id.slice(0, 8).toUpperCase()}`,
      issuedAt: payment.processedAt,
      invoice: {
        id: bundle.invoice.id,
        number: bundle.invoice.number,
        issuedAt: bundle.invoice.issuedAt,
        currency: bundle.invoice.currency,
        totalMinor: bundle.invoice.totalMinor,
      },
      customer: customer ?? { id: bundle.invoice.contactId, name: null, email: null },
      payment: {
        id: payment.id,
        provider: payment.provider,
        providerRef: payment.providerRef,
        method: payment.method,
        amountMinor: payment.amountMinor,
        refundedMinor: payment.refundedMinor,
        netMinor: payment.amountMinor - payment.refundedMinor,
      },
      lines: bundle.lines,
      taxLines: bundle.taxLines,
      refunds: paymentRefunds,
      requiredTaxLegend: bundle.invoice.requiredTaxLegend,
    };
  },
});

export const reconcileMoney = defineService({
  name: "invoicing.reconciliation",
  summary: "Reconcile invoice and payment balances against successful money movements.",
  kind: "query",
  permission: "scoped",
  input: z.object({ limit: z.number().int().min(1).max(5_000).default(1_000) }),
  handler: async (input, ctx) => {
    const invoiceRows = await ctx.tx
      .select()
      .from(invoices)
      .orderBy(desc(invoices.createdAt))
      .limit(input.limit);
    const invoiceIds = invoiceRows.map((invoice) => invoice.id);
    const [paymentRows, refundRows] = invoiceIds.length
      ? await Promise.all([
          ctx.tx.select().from(payments).where(inArray(payments.invoiceId, invoiceIds)),
          ctx.tx.select().from(refunds).where(inArray(refunds.invoiceId, invoiceIds)),
        ])
      : [[], []];
    const discrepancies: Array<{
      subjectType: "invoice" | "payment";
      subjectId: string;
      field: string;
      recordedMinor: number;
      calculatedMinor: number;
    }> = [];
    for (const invoice of invoiceRows) {
      const calculatedPaid = sumMinor(
        paymentRows
          .filter((payment) => payment.invoiceId === invoice.id && payment.status === "succeeded")
          .map((payment) => payment.amountMinor),
        "Reconciled invoice payments",
      );
      const calculatedRefunded = sumMinor(
        refundRows
          .filter((refund) => refund.invoiceId === invoice.id && refund.status === "succeeded")
          .map((refund) => refund.amountMinor),
        "Reconciled invoice refunds",
      );
      if (invoice.paidMinor !== calculatedPaid) {
        discrepancies.push({
          subjectType: "invoice",
          subjectId: invoice.id,
          field: "paidMinor",
          recordedMinor: invoice.paidMinor,
          calculatedMinor: calculatedPaid,
        });
      }
      if (invoice.refundedMinor !== calculatedRefunded) {
        discrepancies.push({
          subjectType: "invoice",
          subjectId: invoice.id,
          field: "refundedMinor",
          recordedMinor: invoice.refundedMinor,
          calculatedMinor: calculatedRefunded,
        });
      }
    }
    for (const payment of paymentRows) {
      const calculatedRefunded = sumMinor(
        refundRows
          .filter((refund) => refund.paymentId === payment.id && refund.status === "succeeded")
          .map((refund) => refund.amountMinor),
        "Reconciled payment refunds",
      );
      if (payment.refundedMinor !== calculatedRefunded) {
        discrepancies.push({
          subjectType: "payment",
          subjectId: payment.id,
          field: "refundedMinor",
          recordedMinor: payment.refundedMinor,
          calculatedMinor: calculatedRefunded,
        });
      }
    }
    return {
      balanced: discrepancies.length === 0,
      checked: {
        invoices: invoiceRows.length,
        payments: paymentRows.length,
        refunds: refundRows.length,
      },
      discrepancies,
    };
  },
});

const createDraftInput = z.object({
  contactId: z.string().uuid(),
  currency,
  sourceType: z.enum(["order", "quote", "booking", "subscription", "manual", "deposit", "balance", "tip", "pay_what_you_want", "late_fee", "unlock"]).default("manual"),
  sourceId: z.string().trim().max(240).optional(),
  idempotencyKey,
  lines: z.array(lineInput).min(1).max(1_000),
  shippingMinor: minor.default(0),
  billingAddress: address.optional(),
  customerTaxId: z.string().trim().max(200).optional(),
  memo: z.string().trim().max(4_000).optional(),
  schedule: boundedObject.optional(),
  depositOfInvoiceId: z.string().uuid().optional(),
  dueAt: z.coerce.date().optional(),
  tax: taxChoice,
});

export const createDraftInvoice = defineService({
  name: "invoicing.createDraft",
  summary: "Create one idempotent draft with fixed-point lines and explicit tax treatment.",
  kind: "mutation",
  permission: "scoped",
  input: createDraftInput,
  handler: async (input, ctx) => {
    const hash = requestHash(input);
    await lock(ctx.tx, "invoice-idempotency", input.idempotencyKey);
    const [existing] = await ctx.tx
      .select({ id: invoices.id, requestHash: invoices.requestHash })
      .from(invoices)
      .where(eq(invoices.idempotencyKey, input.idempotencyKey))
      .limit(1);
    if (existing) {
      if (existing.requestHash !== hash) {
        throw new ServiceError("conflict", "That invoice idempotency key was already used for different contents.");
      }
      return invoiceBundle(ctx.tx, existing.id);
    }

    if (input.depositOfInvoiceId) {
      if (input.sourceType !== "balance") {
        throw new ServiceError("validation", "Only a balance invoice can point to its deposit invoice.");
      }
      const [deposit] = await ctx.tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, input.depositOfInvoiceId))
        .limit(1);
      if (!deposit) throw new ServiceError("not_found", "That deposit invoice is not here.");
      if (deposit.sourceType !== "deposit") {
        throw new ServiceError("validation", "A balance invoice must point to an invoice created as a deposit.");
      }
      if (deposit.contactId !== input.contactId || deposit.currency !== input.currency) {
        throw new ServiceError("validation", "A deposit and its balance must belong to the same contact and currency.");
      }
    }

    const itemKeys = input.lines.map((_, index) => `line:${index}`);
    const taxInput = {
      currency: input.currency,
      contactId: input.contactId,
      items: input.lines.map((line, index) => ({
        id: itemKeys[index]!,
        quantityMicros: line.quantityMicros,
        unitAmountMinor: line.unitAmountMinor,
        discountMinor: line.discountMinor,
        category: line.taxCategoryCode,
        requiresShipping: line.requiresShipping,
      })),
      shippingMinor: input.shippingMinor,
    };
    const quote =
      input.tax.mode === "calculate"
        ? await ctx.call(quoteTax, {
            ...taxInput,
            origin: input.tax.origin,
            destination: input.tax.destination,
          })
        : {
            provider: "explicit_none" as const,
            currency: input.currency,
            lines: [],
            totalTaxMinor: 0,
            includedTaxMinor: 0,
            explanation: [input.tax.reason],
            zone: null,
          };
    const preDiscountQuote =
      input.tax.mode === "calculate" && quote.lines.some((line) => line.inclusive)
        ? await ctx.call(quoteTax, {
            ...taxInput,
            items: taxInput.items.map((line) => ({ ...line, discountMinor: 0 })),
            origin: input.tax.origin,
            destination: input.tax.destination,
          })
        : quote;

    const calculatedLines = input.lines.map((line, index) => {
      const key = itemKeys[index]!;
      const grossSubtotal = extendMinor(line.unitAmountMinor, line.quantityMicros);
      if (line.discountMinor > grossSubtotal) {
        throw new ServiceError("validation", `Line ${index + 1}'s discount exceeds its extended amount.`);
      }
      const currentTax = quote.lines.filter((tax) => tax.itemId === key);
      const beforeTax = preDiscountQuote.lines.filter((tax) => tax.itemId === key);
      const includedAfter = sumMinor(currentTax.filter((tax) => tax.inclusive).map((tax) => tax.taxMinor), "Included line tax");
      const includedBefore = sumMinor(beforeTax.filter((tax) => tax.inclusive).map((tax) => tax.taxMinor), "Included pre-discount tax");
      const taxDiscount = subtractMinor(includedBefore, includedAfter, "Included-tax discount");
      const subtotalMinor = subtractMinor(grossSubtotal, includedBefore, "Net line subtotal");
      const discountMinor = subtractMinor(line.discountMinor, taxDiscount, "Net line discount");
      const taxMinor = sumMinor(currentTax.map((tax) => tax.taxMinor), "Line tax");
      return {
        input: line,
        key,
        position: index,
        subtotalMinor,
        discountMinor,
        taxMinor,
        totalMinor: sumMinor([subtractMinor(subtotalMinor, discountMinor, "Net line"), taxMinor], "Line total"),
      };
    });
    const shippingTaxes = quote.lines.filter((line) => !line.itemId);
    const includedShippingTax = sumMinor(
      shippingTaxes.filter((line) => line.inclusive).map((line) => line.taxMinor),
      "Included shipping tax",
    );
    const netShippingMinor = subtractMinor(input.shippingMinor, includedShippingTax, "Net shipping");
    const subtotalMinor = sumMinor(calculatedLines.map((line) => line.subtotalMinor), "Invoice subtotal");
    const discountMinor = sumMinor(calculatedLines.map((line) => line.discountMinor), "Invoice discount");
    const taxMinor = sumMinor(quote.lines.map((line) => line.taxMinor), "Invoice tax");
    const totalMinor = sumMinor(
      [subtractMinor(subtotalMinor, discountMinor, "Invoice subtotal after discount"), netShippingMinor, taxMinor],
      "Invoice total",
    );
    const quoteDetails = quote as typeof quote & {
      registration?: { number: string | null };
      exemption?: { kind: string } | null;
    };
    const [invoice] = await ctx.tx
      .insert(invoices)
      .values({
        contactId: input.contactId,
        currency: input.currency,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        idempotencyKey: input.idempotencyKey,
        requestHash: hash,
        subtotalMinor,
        discountMinor,
        shippingMinor: netShippingMinor,
        taxMinor,
        taxZoneId: quote.zone?.id,
        totalMinor,
        billingAddress: input.billingAddress,
        customerTaxId: input.customerTaxId,
        requiredTaxLegend:
          quoteDetails.exemption?.kind === "reverse_charge"
            ? "Tax not charged — reverse charge applies."
            : input.tax.mode === "not_applicable"
              ? input.tax.reason
              : quote.totalTaxMinor === 0
                ? quote.explanation.join(" ").slice(0, 4_000)
                : undefined,
        memo: input.memo,
        schedule: input.schedule,
        depositOfInvoiceId: input.depositOfInvoiceId,
        dueAt: input.dueAt,
      })
      .returning();
    const savedLines = await ctx.tx
      .insert(invoiceLines)
      .values(
        calculatedLines.map((line) => ({
          invoiceId: invoice!.id,
          position: line.position,
          sourceType: line.input.sourceType,
          sourceId: line.input.sourceId,
          description: line.input.description,
          quantityMicros: line.input.quantityMicros,
          unitAmountMinor: line.input.unitAmountMinor,
          subtotalMinor: line.subtotalMinor,
          discountMinor: line.discountMinor,
          taxMinor: line.taxMinor,
          totalMinor: line.totalMinor,
          taxCategoryCode: line.input.taxCategoryCode,
          snapshot: line.input.snapshot,
        })),
      )
      .returning();
    const lineIdByKey = new Map(savedLines.map((line) => [itemKeys[line.position]!, line.id]));
    if (quote.lines.length) {
      await ctx.tx.insert(taxLines).values(
        quote.lines.map((line) => ({
          invoiceId: invoice!.id,
          invoiceLineId: line.itemId ? lineIdByKey.get(line.itemId) : undefined,
          kind: quoteDetails.exemption ? "exemption" as const : line.itemId ? "item" as const : "shipping" as const,
          rateName: line.name,
          ratePpm: line.ratePartsPerMillion,
          taxableMinor: line.taxableMinor,
          amountMinor: line.taxMinor,
          jurisdiction: line.jurisdiction,
          registrationNumber: quoteDetails.registration?.number ?? undefined,
          inclusive: line.inclusive,
          compound: line.compound,
          priority: line.priority,
          exemptionKind: quoteDetails.exemption?.kind,
          explanation: quote.explanation.join(" ").slice(0, 4_000),
        })),
      );
    }
    await stateEvent(ctx, "invoice", invoice!.id, null, "draft", "created");
    await ctx.emitTimeline({
      contactId: input.contactId,
      eventType: "invoice.created",
      subjectType: "invoice",
      subjectId: invoice!.id,
      payload: { currency: input.currency, totalMinor, sourceType: input.sourceType },
    });
    ctx.queueEvent("invoice.created", { invoiceId: invoice!.id, contactId: input.contactId, totalMinor, currency: input.currency });
    ctx.setSubject("invoice", invoice!.id);
    return invoiceBundle(ctx.tx, invoice!.id);
  },
});

export const issueInvoice = defineService({
  name: "invoicing.issue",
  summary: "Allocate a gapless number and issue an immutable draft invoice.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid(), dueAt: z.coerce.date().optional() }),
  handler: async (input, ctx) => {
    await lock(ctx.tx, "invoice", input.id);
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, input.id)).limit(1);
    if (!invoice) throw new ServiceError("not_found", "That invoice is not here.");
    if (invoice.status !== "draft") {
      if (invoice.number) return invoiceBundle(ctx.tx, invoice.id);
      throw new ServiceError("conflict", "Only a draft invoice can be issued.");
    }
    const number = await allocateNumber(ctx.tx, invoice.sequenceKey, "INV-");
    const issuedAt = new Date();
    const zero = invoice.totalMinor === 0;
    const [updated] = await ctx.tx
      .update(invoices)
      .set({
        number,
        status: zero ? "paid" : "sent",
        issuedAt,
        dueAt: input.dueAt ?? invoice.dueAt,
        ...(zero ? { paidAt: issuedAt } : {}),
      })
      .where(and(eq(invoices.id, invoice.id), eq(invoices.status, "draft")))
      .returning();
    if (!updated) throw new ServiceError("conflict", "That invoice changed while it was being issued.");
    await stateEvent(ctx, "invoice", updated.id, "draft", updated.status, zero ? "zero_total" : "issued");
    await ctx.emitTimeline({
      contactId: updated.contactId,
      eventType: zero ? "invoice.paid" : "invoice.sent",
      subjectType: "invoice",
      subjectId: updated.id,
      payload: { number, currency: updated.currency, totalMinor: updated.totalMinor },
    });
    ctx.queueEvent(zero ? "invoice.paid" : "invoice.sent", { invoiceId: updated.id, contactId: updated.contactId, number });
    ctx.setSubject("invoice", updated.id);
    return invoiceBundle(ctx.tx, updated.id);
  },
});

export const markInvoiceViewed = defineService({
  name: "invoicing.markViewed",
  summary: "Record the first verified customer view of a sent invoice.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    await lock(ctx.tx, "invoice", input.id);
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, input.id)).limit(1);
    if (!invoice) throw new ServiceError("not_found", "That invoice is not here.");
    if (invoice.status === "viewed" || invoice.viewedAt) return invoice;
    if (invoice.status !== "sent") throw new ServiceError("conflict", "Only a sent invoice can be marked viewed.");
    const [updated] = await ctx.tx.update(invoices).set({ status: "viewed", viewedAt: new Date() }).where(eq(invoices.id, invoice.id)).returning();
    await stateEvent(ctx, "invoice", invoice.id, "sent", "viewed");
    ctx.queueEvent("invoice.viewed", { invoiceId: invoice.id, contactId: invoice.contactId });
    ctx.setSubject("invoice", invoice.id);
    return updated!;
  },
});

export const markInvoiceOverdue = defineService({
  name: "invoicing.markOverdue",
  summary: "Mark a due, unpaid issued invoice overdue without changing its balance.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid(), asOf: z.coerce.date().default(() => new Date()) }),
  handler: async (input, ctx) => {
    await lock(ctx.tx, "invoice", input.id);
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, input.id)).limit(1);
    if (!invoice) throw new ServiceError("not_found", "That invoice is not here.");
    if (invoice.status === "overdue") return invoice;
    if (!inArrayValue(invoice.status, ["sent", "viewed", "partially_paid"]) || !invoice.dueAt || invoice.dueAt >= input.asOf) {
      throw new ServiceError("conflict", "That invoice is not both unpaid and past due.");
    }
    const [updated] = await ctx.tx.update(invoices).set({ status: "overdue" }).where(eq(invoices.id, invoice.id)).returning();
    await stateEvent(ctx, "invoice", invoice.id, invoice.status, "overdue", "past_due");
    ctx.queueEvent("invoice.overdue", { invoiceId: invoice.id, contactId: invoice.contactId });
    ctx.setSubject("invoice", invoice.id);
    return updated!;
  },
});

function inArrayValue<T extends string>(value: string, choices: readonly T[]): value is T {
  return choices.includes(value as T);
}

export const voidInvoice = defineService({
  name: "invoicing.void",
  summary: "Void an unpaid invoice while retaining its issued number and audit trail.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(1_000) }),
  handler: async (input, ctx) => {
    await lock(ctx.tx, "invoice", input.id);
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, input.id)).limit(1);
    if (!invoice) throw new ServiceError("not_found", "That invoice is not here.");
    if (invoice.status === "void") return invoice;
    if (invoice.status === "paid" || invoice.status === "refunded" || invoice.paidMinor > 0) {
      throw new ServiceError("conflict", "A paid invoice cannot be voided. Issue a credit note and refund instead.");
    }
    const [updated] = await ctx.tx
      .update(invoices)
      .set({ status: "void", voidedAt: new Date() })
      .where(eq(invoices.id, invoice.id))
      .returning();
    await stateEvent(ctx, "invoice", invoice.id, invoice.status, "void", input.reason);
    await ctx.emitTimeline({
      contactId: invoice.contactId,
      eventType: "invoice.voided",
      subjectType: "invoice",
      subjectId: invoice.id,
      payload: { reason: input.reason },
    });
    ctx.queueEvent("invoice.voided", { invoiceId: invoice.id, contactId: invoice.contactId });
    ctx.setSubject("invoice", invoice.id);
    return updated!;
  },
});

const paymentInput = z.object({
  invoiceId: z.string().uuid(),
  provider: z.string().trim().min(1).max(100),
  method: z.string().trim().min(1).max(100),
  amountMinor: positiveMinor,
  idempotencyKey,
  metadata: boundedObject.default({}),
});

export const createPayment = defineService({
  name: "invoicing.createPayment",
  summary: "Create an idempotent payment attempt against an issued invoice.",
  kind: "mutation",
  permission: "scoped",
  input: paymentInput,
  handler: async (input, ctx) => {
    const hash = requestHash(input);
    await lock(ctx.tx, "payment-idempotency", `${input.provider}:${input.idempotencyKey}`);
    const [duplicate] = await ctx.tx
      .select()
      .from(payments)
      .where(and(eq(payments.provider, input.provider), eq(payments.idempotencyKey, input.idempotencyKey)))
      .limit(1);
    if (duplicate) {
      if (duplicate.requestHash !== hash) {
        throw new ServiceError("conflict", "That payment idempotency key was already used for a different attempt.");
      }
      return duplicate;
    }
    await lock(ctx.tx, "invoice", input.invoiceId);
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, input.invoiceId)).limit(1);
    if (!invoice) throw new ServiceError("not_found", "That invoice is not here.");
    if (!inArrayValue(invoice.status, ["sent", "viewed", "partially_paid", "overdue"])) {
      throw new ServiceError("conflict", "That invoice is not open for payment.");
    }
    const outstanding = invoice.totalMinor - invoice.paidMinor;
    if (input.amountMinor > outstanding) {
      throw new ServiceError("validation", "The payment exceeds this invoice's outstanding balance.");
    }
    const [created] = await ctx.tx
      .insert(payments)
      .values({
        invoiceId: invoice.id,
        provider: input.provider,
        method: input.method,
        currency: invoice.currency,
        amountMinor: input.amountMinor,
        idempotencyKey: input.idempotencyKey,
        requestHash: hash,
        metadata: input.metadata,
      })
      .returning();
    await stateEvent(ctx, "payment", created!.id, null, "created");
    ctx.queueEvent("payment.created", { paymentId: created!.id, invoiceId: invoice.id, contactId: invoice.contactId });
    ctx.setSubject("payment", created!.id);
    return created!;
  },
});

export const startPayment = defineService({
  name: "invoicing.startPayment",
  summary: "Move a created provider payment into processing.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: z.string().uuid(),
    providerRef: z.string().trim().min(1).max(500).optional(),
    providerCheckoutRef: z.string().trim().min(1).max(500).optional(),
  }),
  handler: async (input, ctx) => {
    await lock(ctx.tx, "payment", input.id);
    const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, input.id)).limit(1);
    if (!payment) throw new ServiceError("not_found", "That payment is not here.");
    if (payment.status === "processing") {
      if (input.providerRef && payment.providerRef && input.providerRef !== payment.providerRef) throw new ServiceError("conflict", "That payment is already processing under a different provider reference.");
      if (input.providerCheckoutRef && payment.providerCheckoutRef && input.providerCheckoutRef !== payment.providerCheckoutRef) throw new ServiceError("conflict", "That payment is already processing under a different checkout reference.");
      return payment;
    }
    if (payment.status !== "created") throw new ServiceError("conflict", "Only a created payment can start processing.");
    const [updated] = await ctx.tx.update(payments).set({
      status: "processing",
      providerRef: input.providerRef,
      providerCheckoutRef: input.providerCheckoutRef,
    }).where(eq(payments.id, payment.id)).returning();
    await stateEvent(ctx, "payment", payment.id, "created", "processing");
    ctx.queueEvent("payment.processing", { paymentId: payment.id, invoiceId: payment.invoiceId });
    ctx.setSubject("payment", payment.id);
    return updated!;
  },
});

export const failPayment = defineService({
  name: "invoicing.failPayment",
  summary: "Record a safe terminal provider failure without leaking its raw response.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    id: z.string().uuid(),
    code: z.string().trim().max(100).optional(),
    message: z.string().trim().min(1).max(500),
  }),
  handler: async (input, ctx) => {
    await lock(ctx.tx, "payment", input.id);
    const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, input.id)).limit(1);
    if (!payment) throw new ServiceError("not_found", "That payment is not here.");
    if (payment.status === "failed") return payment;
    if (!inArrayValue(payment.status, ["created", "processing"])) {
      throw new ServiceError("conflict", "A terminal payment cannot fail again.");
    }
    const [updated] = await ctx.tx.update(payments).set({ status: "failed", failureCode: input.code, failureMessage: input.message, failedAt: new Date() }).where(eq(payments.id, payment.id)).returning();
    await stateEvent(ctx, "payment", payment.id, payment.status, "failed", input.code);
    ctx.queueEvent("payment.failed", { paymentId: payment.id, invoiceId: payment.invoiceId, code: input.code });
    ctx.setSubject("payment", payment.id);
    return updated!;
  },
});

export const cancelPayment = defineService({
  name: "invoicing.cancelPayment",
  summary: "Cancel an unsettled payment attempt while retaining its audit evidence.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(500) }),
  handler: async (input, ctx) => {
    await lock(ctx.tx, "payment", input.id);
    const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, input.id)).limit(1);
    if (!payment) throw new ServiceError("not_found", "That payment is not here.");
    if (payment.status === "cancelled") return payment;
    if (!inArrayValue(payment.status, ["created", "processing"])) {
      throw new ServiceError("conflict", "A terminal payment cannot be cancelled.");
    }
    const [updated] = await ctx.tx
      .update(payments)
      .set({ status: "cancelled", failureCode: null, failureMessage: null })
      .where(eq(payments.id, payment.id))
      .returning();
    await stateEvent(ctx, "payment", payment.id, payment.status, "cancelled", input.reason);
    ctx.queueEvent("payment.cancelled", { paymentId: payment.id, invoiceId: payment.invoiceId });
    ctx.setSubject("payment", payment.id);
    return updated!;
  },
});

export const settlePayment = defineService({
  name: "invoicing.settlePayment",
  summary: "Settle a provider payment and atomically advance the invoice balance.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid(), providerRef: z.string().trim().min(1).max(500), processedAt: z.coerce.date().default(() => new Date()) }),
  handler: async (input, ctx) => {
    await lock(ctx.tx, "payment", input.id);
    const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, input.id)).limit(1);
    if (!payment) throw new ServiceError("not_found", "That payment is not here.");
    if (payment.status === "succeeded") {
      if (payment.providerRef !== input.providerRef) throw new ServiceError("conflict", "That payment already settled under a different provider reference.");
      return payment;
    }
    if (!inArrayValue(payment.status, ["created", "processing"])) {
      throw new ServiceError("conflict", "A failed or cancelled payment cannot settle.");
    }
    await lock(ctx.tx, "invoice", payment.invoiceId);
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, payment.invoiceId)).limit(1);
    if (!invoice) throw new ServiceError("not_found", "That payment's invoice is not here.");
    const paidMinor = sumMinor([invoice.paidMinor, payment.amountMinor], "Paid balance");
    if (paidMinor > invoice.totalMinor) {
      throw new ServiceError("conflict", "Settling this payment would overpay the invoice. Refund or cancel the competing attempt first.");
    }
    const invoiceStatus = paidMinor === invoice.totalMinor ? "paid" as const : "partially_paid" as const;
    const [updatedPayment] = await ctx.tx.update(payments).set({ status: "succeeded", providerRef: input.providerRef, processedAt: input.processedAt, failureCode: null, failureMessage: null }).where(eq(payments.id, payment.id)).returning();
    await ctx.tx.update(invoices).set({ status: invoiceStatus, paidMinor, ...(invoiceStatus === "paid" ? { paidAt: input.processedAt } : {}) }).where(eq(invoices.id, invoice.id));
    await allocateSettledPayment(ctx, updatedPayment!, input.processedAt);
    await stateEvent(ctx, "payment", payment.id, payment.status, "succeeded");
    if (invoice.status !== invoiceStatus) {
      await stateEvent(ctx, "invoice", invoice.id, invoice.status, invoiceStatus, "payment_settled", { paymentId: payment.id, amountMinor: payment.amountMinor });
    }
    await ctx.emitTimeline({
      contactId: invoice.contactId,
      eventType: invoiceStatus === "paid" ? "invoice.paid" : "invoice.partiallyPaid",
      subjectType: "invoice",
      subjectId: invoice.id,
      payload: { paymentId: payment.id, amountMinor: payment.amountMinor, paidMinor, totalMinor: invoice.totalMinor, currency: invoice.currency },
    });
    ctx.queueEvent("payment.succeeded", { paymentId: payment.id, invoiceId: invoice.id, contactId: invoice.contactId, amountMinor: payment.amountMinor });
    ctx.queueEvent(invoiceStatus === "paid" ? "invoice.paid" : "invoice.partiallyPaid", { invoiceId: invoice.id, contactId: invoice.contactId, paidMinor });
    ctx.setSubject("payment", payment.id);
    return updatedPayment!;
  },
});

export const createRefund = defineService({
  name: "invoicing.createRefund",
  summary: "Reserve an idempotent refund amount against one successful payment.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({
    paymentId: z.string().uuid(),
    amountMinor: positiveMinor,
    idempotencyKey,
    reason: z.string().trim().min(3).max(1_000),
  }),
  handler: async (input, ctx) => {
    await lock(ctx.tx, "refund-idempotency", input.idempotencyKey);
    await lock(ctx.tx, "payment", input.paymentId);
    const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, input.paymentId)).limit(1);
    if (!payment) throw new ServiceError("not_found", "That payment is not here.");
    if (payment.status !== "succeeded") throw new ServiceError("conflict", "Only a successful payment can be refunded.");
    const hash = requestHash({ ...input, provider: payment.provider });
    const [duplicate] = await ctx.tx.select().from(refunds).where(and(eq(refunds.provider, payment.provider), eq(refunds.idempotencyKey, input.idempotencyKey))).limit(1);
    if (duplicate) {
      if (duplicate.requestHash !== hash) throw new ServiceError("conflict", "That refund idempotency key was already used for a different refund.");
      return duplicate;
    }
    const reserved = await ctx.tx
      .select({ amountMinor: refunds.amountMinor })
      .from(refunds)
      .where(and(eq(refunds.paymentId, payment.id), inArray(refunds.status, ["created", "processing", "succeeded"])));
    const reservedMinor = sumMinor(reserved.map((row) => row.amountMinor), "Reserved refunds");
    if (sumMinor([reservedMinor, input.amountMinor], "Refund reservation") > payment.amountMinor) {
      throw new ServiceError("validation", "Refunds cannot exceed the successful payment amount.");
    }
    const [created] = await ctx.tx.insert(refunds).values({
      paymentId: payment.id,
      invoiceId: payment.invoiceId,
      provider: payment.provider,
      idempotencyKey: input.idempotencyKey,
      requestHash: hash,
      currency: payment.currency,
      amountMinor: input.amountMinor,
      reason: input.reason,
    }).returning();
    await stateEvent(ctx, "refund", created!.id, null, "created", input.reason);
    ctx.queueEvent("refund.created", { refundId: created!.id, paymentId: payment.id, invoiceId: payment.invoiceId });
    ctx.setSubject("refund", created!.id);
    return created!;
  },
});

export const startRefund = defineService({
  name: "invoicing.startRefund",
  summary: "Move a created provider refund into processing.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid(), providerRef: z.string().trim().min(1).max(500).optional() }),
  handler: async (input, ctx) => {
    await lock(ctx.tx, "refund", input.id);
    const [refund] = await ctx.tx.select().from(refunds).where(eq(refunds.id, input.id)).limit(1);
    if (!refund) throw new ServiceError("not_found", "That refund is not here.");
    if (refund.status === "processing") return refund;
    if (refund.status !== "created") throw new ServiceError("conflict", "Only a created refund can start processing.");
    const [updated] = await ctx.tx.update(refunds).set({ status: "processing", providerRef: input.providerRef }).where(eq(refunds.id, refund.id)).returning();
    await stateEvent(ctx, "refund", refund.id, "created", "processing");
    ctx.queueEvent("refund.processing", { refundId: refund.id, paymentId: refund.paymentId });
    ctx.setSubject("refund", refund.id);
    return updated!;
  },
});

export const failRefund = defineService({
  name: "invoicing.failRefund",
  summary: "Record a safe terminal refund failure and release its reservation.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid(), code: z.string().trim().max(100).optional(), message: z.string().trim().min(1).max(500) }),
  handler: async (input, ctx) => {
    await lock(ctx.tx, "refund", input.id);
    const [refund] = await ctx.tx.select().from(refunds).where(eq(refunds.id, input.id)).limit(1);
    if (!refund) throw new ServiceError("not_found", "That refund is not here.");
    if (refund.status === "failed") return refund;
    if (!inArrayValue(refund.status, ["created", "processing"])) throw new ServiceError("conflict", "A terminal refund cannot fail again.");
    const [updated] = await ctx.tx.update(refunds).set({ status: "failed", failureCode: input.code, failureMessage: input.message, failedAt: new Date() }).where(eq(refunds.id, refund.id)).returning();
    await stateEvent(ctx, "refund", refund.id, refund.status, "failed", input.code);
    ctx.queueEvent("refund.failed", { refundId: refund.id, paymentId: refund.paymentId, code: input.code });
    ctx.setSubject("refund", refund.id);
    return updated!;
  },
});

export const cancelRefund = defineService({
  name: "invoicing.cancelRefund",
  summary: "Cancel an unsettled refund and release its reserved payment balance.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(500) }),
  handler: async (input, ctx) => {
    await lock(ctx.tx, "refund", input.id);
    const [refund] = await ctx.tx.select().from(refunds).where(eq(refunds.id, input.id)).limit(1);
    if (!refund) throw new ServiceError("not_found", "That refund is not here.");
    if (refund.status === "cancelled") return refund;
    if (!inArrayValue(refund.status, ["created", "processing"])) {
      throw new ServiceError("conflict", "A terminal refund cannot be cancelled.");
    }
    const [updated] = await ctx.tx
      .update(refunds)
      .set({ status: "cancelled", failureCode: null, failureMessage: null })
      .where(eq(refunds.id, refund.id))
      .returning();
    await stateEvent(ctx, "refund", refund.id, refund.status, "cancelled", input.reason);
    ctx.queueEvent("refund.cancelled", { refundId: refund.id, paymentId: refund.paymentId });
    ctx.setSubject("refund", refund.id);
    return updated!;
  },
});

export const settleRefund = defineService({
  name: "invoicing.settleRefund",
  summary: "Settle a provider refund and atomically update payment and invoice balances.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ id: z.string().uuid(), providerRef: z.string().trim().min(1).max(500), processedAt: z.coerce.date().default(() => new Date()) }),
  handler: async (input, ctx) => {
    await lock(ctx.tx, "refund", input.id);
    const [refund] = await ctx.tx.select().from(refunds).where(eq(refunds.id, input.id)).limit(1);
    if (!refund) throw new ServiceError("not_found", "That refund is not here.");
    if (refund.status === "succeeded") {
      if (refund.providerRef !== input.providerRef) throw new ServiceError("conflict", "That refund already settled under a different provider reference.");
      return refund;
    }
    if (!inArrayValue(refund.status, ["created", "processing"])) throw new ServiceError("conflict", "A failed or cancelled refund cannot settle.");
    await lock(ctx.tx, "payment", refund.paymentId);
    await lock(ctx.tx, "invoice", refund.invoiceId);
    const [[payment], [invoice]] = await Promise.all([
      ctx.tx.select().from(payments).where(eq(payments.id, refund.paymentId)).limit(1),
      ctx.tx.select().from(invoices).where(eq(invoices.id, refund.invoiceId)).limit(1),
    ]);
    if (!payment || !invoice) throw new ServiceError("not_found", "That refund's payment or invoice is not here.");
    const paymentRefunded = sumMinor([payment.refundedMinor, refund.amountMinor], "Payment refunded balance");
    const invoiceRefunded = sumMinor([invoice.refundedMinor, refund.amountMinor], "Invoice refunded balance");
    if (paymentRefunded > payment.amountMinor || invoiceRefunded > invoice.paidMinor) throw new ServiceError("conflict", "Settling this refund would exceed the paid balance.");
    const invoiceStatus = invoiceRefunded === invoice.paidMinor ? "refunded" as const : invoice.status;
    const [updatedRefund] = await ctx.tx.update(refunds).set({ status: "succeeded", providerRef: input.providerRef, processedAt: input.processedAt, failureCode: null, failureMessage: null }).where(eq(refunds.id, refund.id)).returning();
    await ctx.tx.update(payments).set({ refundedMinor: paymentRefunded }).where(eq(payments.id, payment.id));
    await ctx.tx.update(invoices).set({ refundedMinor: invoiceRefunded, status: invoiceStatus }).where(eq(invoices.id, invoice.id));
    await stateEvent(ctx, "refund", refund.id, refund.status, "succeeded");
    if (invoiceStatus !== invoice.status) await stateEvent(ctx, "invoice", invoice.id, invoice.status, invoiceStatus, "fully_refunded", { refundId: refund.id });
    await ctx.emitTimeline({
      contactId: invoice.contactId,
      eventType: "invoice.refunded",
      subjectType: "invoice",
      subjectId: invoice.id,
      payload: { refundId: refund.id, amountMinor: refund.amountMinor, refundedMinor: invoiceRefunded, currency: invoice.currency, full: invoiceStatus === "refunded" },
    });
    ctx.queueEvent("refund.succeeded", { refundId: refund.id, paymentId: payment.id, invoiceId: invoice.id, contactId: invoice.contactId, amountMinor: refund.amountMinor });
    if (invoiceStatus === "refunded") ctx.queueEvent("invoice.refunded", { invoiceId: invoice.id, contactId: invoice.contactId });
    ctx.setSubject("refund", refund.id);
    return updatedRefund!;
  },
});

const creditLine = z.object({
  invoiceLineId: z.string().uuid().optional(),
  description: z.string().trim().min(1).max(1_000),
  quantityMicros,
  subtotalMinor: minor,
  taxMinor: minor.default(0),
});

export const createCreditNote = defineService({
  name: "invoicing.createCreditNote",
  summary: "Create an idempotent draft credit note bounded by the original invoice.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({
    invoiceId: z.string().uuid(),
    idempotencyKey,
    reason: z.string().trim().min(3).max(1_000),
    lines: z.array(creditLine).min(1).max(1_000),
  }),
  handler: async (input, ctx) => {
    const hash = requestHash(input);
    await lock(ctx.tx, "credit-idempotency", input.idempotencyKey);
    const [duplicate] = await ctx.tx.select().from(creditNotes).where(eq(creditNotes.idempotencyKey, input.idempotencyKey)).limit(1);
    if (duplicate) {
      if (duplicate.requestHash !== hash) throw new ServiceError("conflict", "That credit-note idempotency key was already used for different contents.");
      return duplicate;
    }
    await lock(ctx.tx, "invoice", input.invoiceId);
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, input.invoiceId)).limit(1);
    if (!invoice) throw new ServiceError("not_found", "That invoice is not here.");
    if (invoice.status === "draft" || invoice.status === "void") throw new ServiceError("conflict", "Only an issued, non-void invoice can receive a credit note.");
    const originalLines = await ctx.tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoice.id));
    const originalById = new Map(originalLines.map((line) => [line.id, line]));
    for (const line of input.lines) {
      if (line.invoiceLineId && !originalById.has(line.invoiceLineId)) {
        throw new ServiceError("validation", "A credit line points outside this invoice.");
      }
    }
    const subtotalMinor = sumMinor(input.lines.map((line) => line.subtotalMinor), "Credit subtotal");
    const taxMinor = sumMinor(input.lines.map((line) => line.taxMinor), "Credit tax");
    const totalMinor = sumMinor([subtotalMinor, taxMinor], "Credit total");
    const prior = await ctx.tx.select({ totalMinor: creditNotes.totalMinor }).from(creditNotes).where(and(eq(creditNotes.invoiceId, invoice.id), ne(creditNotes.status, "void")));
    if (sumMinor([...prior.map((row) => row.totalMinor), totalMinor], "Total invoice credits") > invoice.totalMinor) {
      throw new ServiceError("validation", "Credit notes cannot exceed the original invoice total.");
    }
    const [created] = await ctx.tx.insert(creditNotes).values({
      invoiceId: invoice.id,
      idempotencyKey: input.idempotencyKey,
      requestHash: hash,
      currency: invoice.currency,
      reason: input.reason,
      subtotalMinor,
      taxMinor,
      totalMinor,
    }).returning();
    await ctx.tx.insert(creditNoteLines).values(input.lines.map((line, position) => ({
      creditNoteId: created!.id,
      invoiceLineId: line.invoiceLineId,
      position,
      description: line.description,
      quantityMicros: line.quantityMicros,
      subtotalMinor: line.subtotalMinor,
      taxMinor: line.taxMinor,
      totalMinor: sumMinor([line.subtotalMinor, line.taxMinor], "Credit line total"),
    })));
    await stateEvent(ctx, "credit_note", created!.id, null, "draft", input.reason);
    ctx.queueEvent("creditNote.created", { creditNoteId: created!.id, invoiceId: invoice.id, contactId: invoice.contactId });
    ctx.setSubject("creditNote", created!.id);
    return created!;
  },
});

export const issueCreditNote = defineService({
  name: "invoicing.issueCreditNote",
  summary: "Allocate a gapless credit-note number and freeze its draft.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    await lock(ctx.tx, "credit-note", input.id);
    const [note] = await ctx.tx.select().from(creditNotes).where(eq(creditNotes.id, input.id)).limit(1);
    if (!note) throw new ServiceError("not_found", "That credit note is not here.");
    if (note.status === "issued") return note;
    if (note.status !== "draft") throw new ServiceError("conflict", "Only a draft credit note can be issued.");
    const number = await allocateNumber(ctx.tx, note.sequenceKey, "CN-");
    const [updated] = await ctx.tx.update(creditNotes).set({ status: "issued", number, issuedAt: new Date() }).where(eq(creditNotes.id, note.id)).returning();
    await stateEvent(ctx, "credit_note", note.id, "draft", "issued");
    const [invoice] = await ctx.tx.select({ contactId: invoices.contactId }).from(invoices).where(eq(invoices.id, note.invoiceId));
    ctx.queueEvent("creditNote.issued", { creditNoteId: note.id, invoiceId: note.invoiceId, contactId: invoice?.contactId, number });
    ctx.setSubject("creditNote", note.id);
    return updated!;
  },
});

export const voidCreditNote = defineService({
  name: "invoicing.voidCreditNote",
  summary: "Void an issued credit note without deleting its legal number or history.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(1_000) }),
  handler: async (input, ctx) => {
    await lock(ctx.tx, "credit-note", input.id);
    const [note] = await ctx.tx.select().from(creditNotes).where(eq(creditNotes.id, input.id)).limit(1);
    if (!note) throw new ServiceError("not_found", "That credit note is not here.");
    if (note.status === "void") return note;
    if (note.status !== "issued") throw new ServiceError("conflict", "Issue this credit note before voiding it.");
    const [updated] = await ctx.tx.update(creditNotes).set({ status: "void", voidedAt: new Date() }).where(eq(creditNotes.id, note.id)).returning();
    await stateEvent(ctx, "credit_note", note.id, "issued", "void", input.reason);
    ctx.queueEvent("creditNote.voided", { creditNoteId: note.id, invoiceId: note.invoiceId });
    ctx.setSubject("creditNote", note.id);
    return updated!;
  },
});

export default [
  listInvoices,
  getInvoice,
  getPaymentReceipt,
  reconcileMoney,
  createDraftInvoice,
  issueInvoice,
  markInvoiceViewed,
  markInvoiceOverdue,
  voidInvoice,
  createPayment,
  startPayment,
  failPayment,
  cancelPayment,
  settlePayment,
  createRefund,
  startRefund,
  failRefund,
  cancelRefund,
  settleRefund,
  createCreditNote,
  issueCreditNote,
  voidCreditNote,
];
