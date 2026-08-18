// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.08 advanced money terms on top of the one invoice/payment ledger.

import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { registerContactReference } from "@/core/contacts/service";
import { registerContactPrivacySource } from "@/core/privacy/service";
import { listed, timestamp, uuid } from "@/core/contract";
import { actorString, defineService, ServiceError, type ServiceContext, type Tx } from "@/core/service";
import { HOSTED_PAYMENT_PROVIDER_IDS } from "@/adapters/payments/providers";
import {
  customerBalanceAccountRow,
  customerBalanceEntryRow,
  flexiblePaymentRow,
  invoiceRow,
  lateFeeAssessmentRow,
  paymentAllocationRow,
  paymentPlanInstallmentRow,
  paymentPlanRow,
  paymentRow,
  providerBalanceTransactionRow,
  providerPayoutRow,
  refundRow,
} from "./contract";
import {
  customerBalanceAccounts,
  customerBalanceEntries,
  flexiblePayments,
  invoices,
  lateFeeAssessments,
  moneyStateEvents,
  paymentAllocations,
  paymentPlanInstallments,
  paymentPlans,
  payments,
  providerBalanceTransactions,
  providerPayoutItems,
  providerPayouts,
} from "./schema";
import {
  createDraftInvoice,
  createPayment,
  createRefund,
  issueInvoice,
  settlePayment,
  settleRefund,
} from "./invoice-service";
import { roundRatio, safeMinor, sumMinor } from "./money";

const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);
const minor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveMinor = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const signedMinor = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const idempotencyKey = z.string().trim().min(1).max(240);
const provider = z.enum(HOSTED_PAYMENT_PROVIDER_IDS);
const boundedObject = z.record(z.string().min(1).max(100), z.unknown()).refine((value) => {
  try { return JSON.stringify(value).length <= 65_536; } catch { return false; }
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
const taxChoice = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("calculate"), origin: taxAddress, destination: taxAddress }),
  z.object({ mode: z.literal("not_applicable"), reason: z.string().trim().min(3).max(1_000) }),
]);
const invoiceLine = z.object({
  sourceType: z.string().trim().max(80).optional(),
  sourceId: z.string().trim().max(240).optional(),
  description: z.string().trim().min(1).max(1_000),
  quantityMicros: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  unitAmountMinor: minor,
  discountMinor: minor.default(0),
  taxCategoryCode: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/).max(80).default("standard"),
  requiresShipping: z.boolean().default(false),
  snapshot: boundedObject.default({}),
});

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function requestHash(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

async function lock(tx: Tx, kind: string, id: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${kind}:${id}`}))`);
}

async function invoicePairResult(ctx: ServiceContext, depositId: string, balanceId: string) {
  const rows = await ctx.tx.select().from(invoices).where(inArray(invoices.id, [depositId, balanceId]));
  return {
    deposit: rows.find((row) => row.id === depositId)!,
    balance: rows.find((row) => row.id === balanceId)!,
  };
}

export const createDepositAndBalanceInvoices = defineService({
  name: "invoicing.createDepositAndBalance",
  summary: "Create an idempotent linked deposit and balance without mutating either issued invoice.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    contactId: z.string().uuid(),
    currency,
    sourceType: z.enum(["order", "quote", "booking", "subscription", "manual"]),
    sourceId: z.string().trim().min(1).max(220),
    deposit: z.object({ lines: z.array(invoiceLine).min(1).max(1_000), shippingMinor: minor.default(0), dueAt: z.coerce.date().optional() }),
    balance: z.object({ lines: z.array(invoiceLine).min(1).max(1_000), shippingMinor: minor.default(0), dueAt: z.coerce.date().optional() }),
    billingAddress: address.optional(),
    customerTaxId: z.string().trim().max(200).optional(),
    memo: z.string().trim().max(4_000).optional(),
    tax: taxChoice,
    issueNow: z.boolean().default(false),
    idempotencyKey,
  }),
  output: z.object({
    deposit: invoiceRow,
    balance: invoiceRow,
  }),
  handler: async (input, ctx) => {
    const operationHash = requestHash(input);
    const depositIdempotencyKey = `deposit:${operationHash}`;
    const balanceIdempotencyKey = `balance:${operationHash}`;
    const sourceDepositId = `${input.sourceType}:${input.sourceId}:deposit`;
    const sourceBalanceId = `${input.sourceType}:${input.sourceId}:balance`;
    await lock(ctx.tx, "deposit-balance-source", `${input.sourceType}:${input.sourceId}`);
    const sourceRows = await ctx.tx.select().from(invoices).where(and(
      inArray(invoices.sourceType, ["deposit", "balance"]),
      inArray(invoices.sourceId, [sourceDepositId, sourceBalanceId]),
    ));
    if (sourceRows.length && !(
      sourceRows.length === 2
      && sourceRows.some((row) => row.sourceType === "deposit" && row.idempotencyKey === depositIdempotencyKey)
      && sourceRows.some((row) => row.sourceType === "balance" && row.idempotencyKey === balanceIdempotencyKey)
    )) {
      throw new ServiceError("conflict", "That source already has different deposit or balance terms.");
    }
    const deposit = await ctx.call(createDraftInvoice, {
      contactId: input.contactId,
      currency: input.currency,
      sourceType: "deposit",
      sourceId: sourceDepositId,
      idempotencyKey: depositIdempotencyKey,
      lines: input.deposit.lines,
      shippingMinor: input.deposit.shippingMinor,
      billingAddress: input.billingAddress,
      customerTaxId: input.customerTaxId,
      memo: input.memo,
      schedule: { kind: "deposit", sourceType: input.sourceType, sourceId: input.sourceId },
      dueAt: input.deposit.dueAt,
      tax: input.tax,
    });
    const balance = await ctx.call(createDraftInvoice, {
      contactId: input.contactId,
      currency: input.currency,
      sourceType: "balance",
      sourceId: sourceBalanceId,
      idempotencyKey: balanceIdempotencyKey,
      lines: input.balance.lines,
      shippingMinor: input.balance.shippingMinor,
      billingAddress: input.billingAddress,
      customerTaxId: input.customerTaxId,
      memo: input.memo,
      schedule: { kind: "balance", sourceType: input.sourceType, sourceId: input.sourceId, depositInvoiceId: deposit.invoice.id },
      depositOfInvoiceId: deposit.invoice.id,
      dueAt: input.balance.dueAt,
      tax: input.tax,
    });
    if (deposit.invoice.totalMinor <= 0 || balance.invoice.totalMinor <= 0) {
      throw new ServiceError("validation", "Both the deposit and balance must be greater than zero.");
    }
    if (input.issueNow) {
      await ctx.call(issueInvoice, { id: deposit.invoice.id, dueAt: input.deposit.dueAt });
      await ctx.call(issueInvoice, { id: balance.invoice.id, dueAt: input.balance.dueAt });
    }
    ctx.queueEvent("invoice.depositAndBalanceCreated", { contactId: input.contactId, depositInvoiceId: deposit.invoice.id, balanceInvoiceId: balance.invoice.id });
    return invoicePairResult(ctx, deposit.invoice.id, balance.invoice.id);
  },
});

export const createPaymentPlan = defineService({
  name: "invoicing.createPaymentPlan",
  summary: "Schedule an issued invoice's outstanding balance into exact installments.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    invoiceId: z.string().uuid(),
    installments: z.array(z.object({ dueAt: z.coerce.date(), amountMinor: positiveMinor })).min(2).max(120),
    idempotencyKey,
  }),
  output: z.object({
    plan: paymentPlanRow,
    installments: listed(paymentPlanInstallmentRow),
  }),
  handler: async (input, ctx) => {
    const hash = requestHash(input);
    await lock(ctx.tx, "payment-plan-idempotency", input.idempotencyKey);
    const [duplicate] = await ctx.tx.select().from(paymentPlans).where(eq(paymentPlans.idempotencyKey, input.idempotencyKey)).limit(1);
    if (duplicate) {
      if (duplicate.requestHash !== hash) throw new ServiceError("conflict", "That payment-plan idempotency key was already used for different terms.");
      const installments = await ctx.tx.select().from(paymentPlanInstallments).where(eq(paymentPlanInstallments.planId, duplicate.id)).orderBy(asc(paymentPlanInstallments.position));
      return { plan: duplicate, installments };
    }
    await lock(ctx.tx, "invoice", input.invoiceId);
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, input.invoiceId)).limit(1);
    if (!invoice) throw new ServiceError("not_found", "That invoice is not here.");
    if (!invoice.number || !["sent", "viewed", "partially_paid", "overdue"].includes(invoice.status)) {
      throw new ServiceError("conflict", "Only an issued invoice with an outstanding balance can receive a payment plan.");
    }
    const [existingPlan] = await ctx.tx.select({ id: paymentPlans.id }).from(paymentPlans).where(eq(paymentPlans.invoiceId, invoice.id)).limit(1);
    if (existingPlan) throw new ServiceError("conflict", "That invoice already has a payment plan.");
    const outstandingMinor = invoice.totalMinor - invoice.paidMinor;
    if (sumMinor(input.installments.map((row) => row.amountMinor), "Payment-plan principal") !== outstandingMinor) {
      throw new ServiceError("validation", "Installments must add up exactly to the invoice's current outstanding balance.");
    }
    for (let index = 1; index < input.installments.length; index += 1) {
      if (input.installments[index]!.dueAt <= input.installments[index - 1]!.dueAt) {
        throw new ServiceError("validation", "Installment due dates must be strictly increasing.");
      }
    }
    const [plan] = await ctx.tx.insert(paymentPlans).values({
      invoiceId: invoice.id,
      idempotencyKey: input.idempotencyKey,
      requestHash: hash,
      currency: invoice.currency,
      principalMinor: outstandingMinor,
    }).returning();
    const installments = await ctx.tx.insert(paymentPlanInstallments).values(input.installments.map((row, position) => ({
      planId: plan!.id,
      position,
      dueAt: row.dueAt,
      amountMinor: row.amountMinor,
      status: row.dueAt <= new Date() ? "due" as const : "scheduled" as const,
    }))).returning();
    await ctx.tx.insert(moneyStateEvents).values({ subjectType: "payment_plan", subjectId: plan!.id, fromState: null, toState: "active", actor: actorString(ctx.actor), reason: "created" });
    ctx.queueEvent("paymentPlan.created", { paymentPlanId: plan!.id, invoiceId: invoice.id, contactId: invoice.contactId });
    ctx.setSubject("paymentPlan", plan!.id);
    return { plan: plan!, installments };
  },
});

export const getPaymentPlan = defineService({
  name: "invoicing.getPaymentPlan",
  summary: "Read a payment plan, its installments, and exact payment allocations.",
  kind: "query",
  permission: "scoped",
  input: z.object({ invoiceId: z.string().uuid() }),
  output: z.object({
    plan: paymentPlanRow,
    installments: listed(paymentPlanInstallmentRow),
    allocations: listed(paymentAllocationRow),
  }),
  handler: async (input, ctx) => {
    const [plan] = await ctx.tx.select().from(paymentPlans).where(eq(paymentPlans.invoiceId, input.invoiceId)).limit(1);
    if (!plan) throw new ServiceError("not_found", "That invoice does not have a payment plan.");
    const installments = await ctx.tx.select().from(paymentPlanInstallments).where(eq(paymentPlanInstallments.planId, plan.id)).orderBy(asc(paymentPlanInstallments.position));
    const ids = installments.map((row) => row.id);
    const allocations = ids.length
      ? await ctx.tx.select().from(paymentAllocations).where(inArray(paymentAllocations.installmentId, ids)).orderBy(asc(paymentAllocations.createdAt))
      : [];
    return { plan, installments, allocations };
  },
});

export const refreshPaymentPlans = defineService({
  name: "invoicing.refreshPaymentPlans",
  summary: "Advance due/defaulted plan status from an explicit reconciliation time.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ asOf: z.coerce.date().default(() => new Date()), limit: z.number().int().min(1).max(5_000).default(1_000) }),
  output: z.object({
    checked: z.number().int(),
    changed: z.number().int(),
    asOf: timestamp,
  }),
  handler: async (input, ctx) => {
    const rows = await ctx.tx.select().from(paymentPlans).where(inArray(paymentPlans.status, ["active", "defaulted"])).orderBy(asc(paymentPlans.createdAt)).limit(input.limit);
    let changed = 0;
    for (const plan of rows) {
      await lock(ctx.tx, "payment-plan", plan.id);
      const installments = await ctx.tx.select().from(paymentPlanInstallments).where(eq(paymentPlanInstallments.planId, plan.id)).orderBy(asc(paymentPlanInstallments.position));
      let hasDefault = false;
      for (const row of installments) {
        if (row.status === "paid" || row.status === "waived") continue;
        const overdue = row.dueAt < input.asOf;
        const status = row.paidMinor > 0 ? "partially_paid" as const : overdue ? "defaulted" as const : row.dueAt <= input.asOf ? "due" as const : "scheduled" as const;
        if (overdue && row.paidMinor < row.amountMinor) hasDefault = true;
        if (status !== row.status) {
          await ctx.tx.update(paymentPlanInstallments).set({ status }).where(eq(paymentPlanInstallments.id, row.id));
          changed += 1;
        }
      }
      const status = hasDefault ? "defaulted" as const : "active" as const;
      if (status !== plan.status) {
        await ctx.tx.update(paymentPlans).set({ status }).where(eq(paymentPlans.id, plan.id));
        await ctx.tx.insert(moneyStateEvents).values({ subjectType: "payment_plan", subjectId: plan.id, fromState: plan.status, toState: status, actor: actorString(ctx.actor), reason: "schedule_refreshed", occurredAt: input.asOf });
        changed += 1;
      }
    }
    return { checked: rows.length, changed, asOf: input.asOf };
  },
});

export const cancelPaymentPlan = defineService({
  name: "invoicing.cancelPaymentPlan",
  summary: "Cancel future payment-plan terms while retaining all allocations.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({ id: z.string().uuid(), reason: z.string().trim().min(3).max(1_000) }),
  output: paymentPlanRow,
  handler: async (input, ctx) => {
    await lock(ctx.tx, "payment-plan", input.id);
    const [plan] = await ctx.tx.select().from(paymentPlans).where(eq(paymentPlans.id, input.id)).limit(1);
    if (!plan) throw new ServiceError("not_found", "That payment plan is not here.");
    if (plan.status === "cancelled") return plan;
    if (plan.status === "completed") throw new ServiceError("conflict", "A completed payment plan cannot be cancelled.");
    const cancelledAt = new Date();
    const [updated] = await ctx.tx.update(paymentPlans).set({ status: "cancelled", cancelledAt }).where(eq(paymentPlans.id, plan.id)).returning();
    await ctx.tx.insert(moneyStateEvents).values({ subjectType: "payment_plan", subjectId: plan.id, fromState: plan.status, toState: "cancelled", actor: actorString(ctx.actor), reason: input.reason, occurredAt: cancelledAt });
    ctx.queueEvent("paymentPlan.cancelled", { paymentPlanId: plan.id, invoiceId: plan.invoiceId });
    return updated!;
  },
});

export const createFlexiblePaymentInvoice = defineService({
  name: "invoicing.createFlexiblePayment",
  summary: "Turn a bounded tip or pay-what-you-want choice into a normal invoice.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    kind: z.enum(["tip", "pay_what_you_want"]),
    contactId: z.string().uuid(),
    currency,
    chosenMinor: positiveMinor,
    minimumMinor: minor.default(0),
    maximumMinor: positiveMinor.optional(),
    context: z.enum(["checkout", "invoice", "gallery", "booking", "store", "other"]),
    attachedInvoiceId: z.string().uuid().optional(),
    description: z.string().trim().min(1).max(1_000),
    message: z.string().trim().max(2_000).optional(),
    taxCategoryCode: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/).max(80).default("standard"),
    tax: taxChoice,
    dueAt: z.coerce.date().optional(),
    issueNow: z.boolean().default(true),
    idempotencyKey,
  }),
  output: z.object({
    flexiblePayment: flexiblePaymentRow,
    invoice: invoiceRow,
  }),
  handler: async (input, ctx) => {
    const hash = requestHash(input);
    await lock(ctx.tx, "flexible-payment-idempotency", input.idempotencyKey);
    const [duplicate] = await ctx.tx.select().from(flexiblePayments).where(eq(flexiblePayments.idempotencyKey, input.idempotencyKey)).limit(1);
    if (duplicate) {
      if (duplicate.requestHash !== hash) throw new ServiceError("conflict", "That flexible-payment idempotency key was already used for a different choice.");
      const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, duplicate.invoiceId)).limit(1);
      return { flexiblePayment: duplicate, invoice: invoice! };
    }
    if (input.chosenMinor < input.minimumMinor || (input.maximumMinor !== undefined && input.chosenMinor > input.maximumMinor)) {
      throw new ServiceError("validation", "The chosen amount is outside the offer's allowed range.");
    }
    if (input.maximumMinor !== undefined && input.maximumMinor < input.minimumMinor) {
      throw new ServiceError("validation", "The maximum amount cannot be below the minimum amount.");
    }
    if (input.attachedInvoiceId) {
      const [attached] = await ctx.tx.select().from(invoices).where(eq(invoices.id, input.attachedInvoiceId)).limit(1);
      if (!attached) throw new ServiceError("not_found", "The invoice this payment attaches to is not here.");
      if (attached.contactId !== input.contactId || attached.currency !== input.currency) {
        throw new ServiceError("validation", "An attached tip or voluntary payment must use the same contact and currency.");
      }
    }
    const draft = await ctx.call(createDraftInvoice, {
      contactId: input.contactId,
      currency: input.currency,
      sourceType: input.kind,
      sourceId: `flexible:${hash}`,
      idempotencyKey: `flexible:${hash}`,
      lines: [{
        description: input.description,
        quantityMicros: 1_000_000,
        unitAmountMinor: input.chosenMinor,
        discountMinor: 0,
        taxCategoryCode: input.taxCategoryCode,
        requiresShipping: false,
        snapshot: { flexibleKind: input.kind, context: input.context, attachedInvoiceId: input.attachedInvoiceId },
      }],
      shippingMinor: 0,
      memo: input.message,
      dueAt: input.dueAt,
      tax: input.tax,
    });
    const [created] = await ctx.tx.insert(flexiblePayments).values({
      invoiceId: draft.invoice.id,
      attachedInvoiceId: input.attachedInvoiceId,
      kind: input.kind,
      context: input.context,
      chosenMinor: input.chosenMinor,
      minimumMinor: input.minimumMinor,
      maximumMinor: input.maximumMinor,
      message: input.message,
      idempotencyKey: input.idempotencyKey,
      requestHash: hash,
    }).returning();
    const result = input.issueNow ? await ctx.call(issueInvoice, { id: draft.invoice.id, dueAt: input.dueAt }) : draft;
    ctx.queueEvent(input.kind === "tip" ? "tip.created" : "payWhatYouWant.created", { flexiblePaymentId: created!.id, invoiceId: draft.invoice.id, contactId: input.contactId, amountMinor: input.chosenMinor });
    return { flexiblePayment: created!, invoice: result.invoice };
  },
});

const lateFeeTerms = z.discriminatedUnion("basis", [
  z.object({ basis: z.literal("fixed"), fixedMinor: positiveMinor, capMinor: positiveMinor.optional() }),
  z.object({ basis: z.literal("percentage"), ratePpm: z.number().int().min(1).max(10_000_000), capMinor: positiveMinor.optional() }),
]);

export const assessLateFee = defineService({
  name: "invoicing.assessLateFee",
  summary: "Assess a bounded late fee as a linked invoice, preserving the original legal invoice.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({
    invoiceId: z.string().uuid(),
    terms: lateFeeTerms,
    graceDays: z.number().int().min(0).max(3_650).default(0),
    asOf: z.coerce.date().default(() => new Date()),
    reason: z.string().trim().min(3).max(1_000),
    taxCategoryCode: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/).max(80).default("standard"),
    tax: taxChoice,
    dueAt: z.coerce.date().optional(),
    issueNow: z.boolean().default(true),
    idempotencyKey,
  }),
  output: z.object({
    assessment: lateFeeAssessmentRow,
    invoice: invoiceRow,
  }),
  handler: async (input, ctx) => {
    const hash = requestHash(input);
    await lock(ctx.tx, "late-fee-idempotency", input.idempotencyKey);
    const [duplicate] = await ctx.tx.select().from(lateFeeAssessments).where(eq(lateFeeAssessments.idempotencyKey, input.idempotencyKey)).limit(1);
    if (duplicate) {
      if (duplicate.requestHash !== hash) throw new ServiceError("conflict", "That late-fee idempotency key was already used for different terms.");
      const [feeInvoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, duplicate.feeInvoiceId)).limit(1);
      return { assessment: duplicate, invoice: feeInvoice! };
    }
    await lock(ctx.tx, "invoice", input.invoiceId);
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, input.invoiceId)).limit(1);
    if (!invoice) throw new ServiceError("not_found", "That invoice is not here.");
    if (!invoice.number || !invoice.dueAt || !["sent", "viewed", "partially_paid", "overdue"].includes(invoice.status)) {
      throw new ServiceError("conflict", "Only an issued, unpaid invoice with a due date can receive a late fee.");
    }
    const eligibleAt = new Date(invoice.dueAt.getTime() + input.graceDays * 86_400_000);
    if (input.asOf <= eligibleAt) throw new ServiceError("conflict", "The invoice is still inside its due-date or grace period.");
    const outstandingMinor = invoice.totalMinor - invoice.paidMinor;
    let assessedMinor = input.terms.basis === "fixed"
      ? input.terms.fixedMinor
      : safeMinor(roundRatio(BigInt(outstandingMinor) * BigInt(input.terms.ratePpm), 1_000_000n), "Late fee");
    if (input.terms.capMinor !== undefined) assessedMinor = Math.min(assessedMinor, input.terms.capMinor);
    if (assessedMinor <= 0) throw new ServiceError("validation", "The late-fee terms calculate to zero.");
    const draft = await ctx.call(createDraftInvoice, {
      contactId: invoice.contactId,
      currency: invoice.currency,
      sourceType: "late_fee",
      sourceId: `late-fee:${hash}`,
      idempotencyKey: `late-fee:${hash}`,
      lines: [{
        description: `Late fee for invoice ${invoice.number}`,
        quantityMicros: 1_000_000,
        unitAmountMinor: assessedMinor,
        discountMinor: 0,
        taxCategoryCode: input.taxCategoryCode,
        requiresShipping: false,
        snapshot: { sourceInvoiceId: invoice.id, sourceInvoiceNumber: invoice.number, outstandingMinor, terms: input.terms, graceDays: input.graceDays, assessedAt: input.asOf.toISOString() },
      }],
      shippingMinor: 0,
      memo: input.reason,
      dueAt: input.dueAt,
      tax: input.tax,
    });
    const [created] = await ctx.tx.insert(lateFeeAssessments).values({
      sourceInvoiceId: invoice.id,
      feeInvoiceId: draft.invoice.id,
      basis: input.terms.basis,
      outstandingMinor,
      fixedMinor: input.terms.basis === "fixed" ? input.terms.fixedMinor : undefined,
      ratePpm: input.terms.basis === "percentage" ? input.terms.ratePpm : undefined,
      capMinor: input.terms.capMinor,
      graceDays: input.graceDays,
      assessedMinor,
      assessedAt: input.asOf,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      requestHash: hash,
    }).returning();
    const result = input.issueNow ? await ctx.call(issueInvoice, { id: draft.invoice.id, dueAt: input.dueAt }) : draft;
    ctx.queueEvent("invoice.lateFeeAssessed", { assessmentId: created!.id, sourceInvoiceId: invoice.id, feeInvoiceId: draft.invoice.id, contactId: invoice.contactId, amountMinor: assessedMinor });
    return { assessment: created!, invoice: result.invoice };
  },
});

async function balanceAccount(tx: Tx, contactId: string, currencyCode: string) {
  await lock(tx, "customer-balance-account", `${contactId}:${currencyCode}`);
  await tx.insert(customerBalanceAccounts).values({ contactId, currency: currencyCode }).onConflictDoNothing();
  const [account] = await tx.select().from(customerBalanceAccounts).where(and(eq(customerBalanceAccounts.contactId, contactId), eq(customerBalanceAccounts.currency, currencyCode))).limit(1);
  if (!account) throw new ServiceError("conflict", "The customer balance account could not be opened safely.");
  return account;
}

async function changeBalance(
  ctx: ServiceContext,
  input: {
    contactId: string;
    currency: string;
    deltaMinor: number;
    kind: "credit" | "debit" | "refund" | "adjustment";
    sourceType: string;
    sourceId?: string;
    reason: string;
    idempotencyKey: string;
  },
) {
  const hash = requestHash(input);
  const account = await balanceAccount(ctx.tx, input.contactId, input.currency);
  const [duplicate] = await ctx.tx.select().from(customerBalanceEntries).where(and(eq(customerBalanceEntries.accountId, account.id), eq(customerBalanceEntries.idempotencyKey, input.idempotencyKey))).limit(1);
  if (duplicate) {
    if (duplicate.requestHash !== hash) throw new ServiceError("conflict", "That balance idempotency key was already used for a different movement.");
    const [current] = await ctx.tx.select().from(customerBalanceAccounts).where(eq(customerBalanceAccounts.id, account.id)).limit(1);
    return { account: current!, entry: duplicate };
  }
  if (input.deltaMinor === 0) throw new ServiceError("validation", "A balance movement cannot be zero.");
  const balanceAfterMinor = account.balanceMinor + input.deltaMinor;
  if (!Number.isSafeInteger(balanceAfterMinor) || balanceAfterMinor < 0) {
    throw new ServiceError("conflict", "The customer balance does not have enough available credit.");
  }
  const [entry] = await ctx.tx.insert(customerBalanceEntries).values({
    accountId: account.id,
    kind: input.kind,
    deltaMinor: input.deltaMinor,
    balanceAfterMinor,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    idempotencyKey: input.idempotencyKey,
    requestHash: hash,
    reason: input.reason,
    actor: actorString(ctx.actor),
  }).returning();
  const [updated] = await ctx.tx.update(customerBalanceAccounts).set({ balanceMinor: balanceAfterMinor }).where(eq(customerBalanceAccounts.id, account.id)).returning();
  return { account: updated!, entry: entry! };
}

export const adjustCustomerBalance = defineService({
  name: "invoicing.adjustCustomerBalance",
  summary: "Post an auditable owner-authorized credit or debit to a customer's currency balance.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({
    contactId: z.string().uuid(),
    currency,
    direction: z.enum(["credit", "debit"]),
    amountMinor: positiveMinor,
    reason: z.string().trim().min(3).max(1_000),
    externalReference: z.string().trim().min(1).max(500).optional(),
    idempotencyKey,
  }),
  output: z.object({
    account: customerBalanceAccountRow,
    entry: customerBalanceEntryRow,
  }),
  handler: async (input, ctx) => {
    const result = await changeBalance(ctx, {
      contactId: input.contactId,
      currency: input.currency,
      deltaMinor: input.direction === "credit" ? input.amountMinor : -input.amountMinor,
      kind: input.direction,
      sourceType: "manual_adjustment",
      sourceId: input.externalReference,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
    });
    ctx.queueEvent("customerBalance.adjusted", { contactId: input.contactId, currency: input.currency, deltaMinor: result.entry.deltaMinor, balanceMinor: result.account.balanceMinor });
    ctx.setSubject("customerBalance", result.account.id);
    return result;
  },
});

export const applyCustomerBalance = defineService({
  name: "invoicing.applyCustomerBalance",
  summary: "Pay part or all of an invoice from customer credit through the normal payment ledger.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ invoiceId: z.string().uuid(), amountMinor: positiveMinor, idempotencyKey }),
  output: z.object({
    payment: paymentRow,
    account: customerBalanceAccountRow,
    entry: customerBalanceEntryRow.optional(),
  }),
  handler: async (input, ctx) => {
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, input.invoiceId)).limit(1);
    if (!invoice) throw new ServiceError("not_found", "That invoice is not here.");
    const payment = await ctx.call(createPayment, {
      invoiceId: invoice.id,
      provider: "balance",
      method: "customer_balance",
      amountMinor: input.amountMinor,
      idempotencyKey: input.idempotencyKey,
      metadata: { customerBalance: true },
    });
    if (payment.status === "succeeded") {
      const [account] = await ctx.tx.select().from(customerBalanceAccounts).where(and(eq(customerBalanceAccounts.contactId, invoice.contactId), eq(customerBalanceAccounts.currency, invoice.currency))).limit(1);
      return { payment, account: account! };
    }
    const movement = await changeBalance(ctx, {
      contactId: invoice.contactId,
      currency: invoice.currency,
      deltaMinor: -input.amountMinor,
      kind: "debit",
      sourceType: "payment",
      sourceId: payment.id,
      reason: `Applied to invoice ${invoice.number ?? invoice.id}`,
      idempotencyKey: `payment:${input.idempotencyKey}`,
    });
    const settled = await ctx.call(settlePayment, { id: payment.id, providerRef: `balance:${movement.entry.id}` });
    ctx.queueEvent("customerBalance.applied", { contactId: invoice.contactId, invoiceId: invoice.id, paymentId: payment.id, amountMinor: input.amountMinor, balanceMinor: movement.account.balanceMinor });
    return { payment: settled, account: movement.account, entry: movement.entry };
  },
});

export const refundCustomerBalancePayment = defineService({
  name: "invoicing.refundCustomerBalancePayment",
  summary: "Refund a balance-funded payment and atomically restore the customer's credit.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({ paymentId: z.string().uuid(), amountMinor: positiveMinor, reason: z.string().trim().min(3).max(1_000), idempotencyKey }),
  output: z.object({
    refund: refundRow,
    account: customerBalanceAccountRow,
    entry: customerBalanceEntryRow.optional(),
  }),
  handler: async (input, ctx) => {
    const [row] = await ctx.tx.select({ payment: payments, invoice: invoices }).from(payments).innerJoin(invoices, eq(invoices.id, payments.invoiceId)).where(eq(payments.id, input.paymentId)).limit(1);
    if (!row || row.payment.provider !== "balance") throw new ServiceError("conflict", "That payment was not funded from a customer balance.");
    const refund = await ctx.call(createRefund, input);
    if (refund.status === "succeeded") {
      const [account] = await ctx.tx.select().from(customerBalanceAccounts).where(and(eq(customerBalanceAccounts.contactId, row.invoice.contactId), eq(customerBalanceAccounts.currency, row.invoice.currency))).limit(1);
      return { refund, account: account! };
    }
    const movement = await changeBalance(ctx, {
      contactId: row.invoice.contactId,
      currency: row.invoice.currency,
      deltaMinor: input.amountMinor,
      kind: "refund",
      sourceType: "refund",
      sourceId: refund.id,
      reason: input.reason,
      idempotencyKey: `refund:${input.idempotencyKey}`,
    });
    const settled = await ctx.call(settleRefund, { id: refund.id, providerRef: `balance-refund:${movement.entry.id}` });
    ctx.queueEvent("customerBalance.refunded", { contactId: row.invoice.contactId, invoiceId: row.invoice.id, refundId: refund.id, amountMinor: input.amountMinor, balanceMinor: movement.account.balanceMinor });
    return { refund: settled, account: movement.account, entry: movement.entry };
  },
});

export const getCustomerBalance = defineService({
  name: "invoicing.getCustomerBalance",
  summary: "Read one customer's balance accounts and immutable movement history.",
  kind: "query",
  permission: "scoped",
  input: z.object({ contactId: z.string().uuid(), currency: currency.optional(), limit: z.number().int().min(1).max(5_000).default(500) }),
  output: z.object({
    accounts: listed(customerBalanceAccountRow),
    entries: listed(customerBalanceEntryRow),
  }),
  handler: async (input, ctx) => {
    const accounts = await ctx.tx.select().from(customerBalanceAccounts).where(and(eq(customerBalanceAccounts.contactId, input.contactId), input.currency ? eq(customerBalanceAccounts.currency, input.currency) : undefined)).orderBy(asc(customerBalanceAccounts.currency));
    const accountIds = accounts.map((row) => row.id);
    const entries = accountIds.length ? await ctx.tx.select().from(customerBalanceEntries).where(inArray(customerBalanceEntries.accountId, accountIds)).orderBy(desc(customerBalanceEntries.createdAt)).limit(input.limit) : [];
    return { accounts, entries };
  },
});

export interface ProviderPayoutObservation {
  providerRef: string;
  status: "pending" | "in_transit" | "paid" | "failed" | "cancelled";
  currency: string;
  amountMinor: number;
  occurredAt: Date;
  expectedAt?: Date;
  statementRef?: string;
  failureReason?: string;
}

/** Shared by signed webhooks and the statement-import service below. */
export async function observeProviderPayout(
  ctx: ServiceContext,
  providerId: string,
  observation: ProviderPayoutObservation,
) {
  await lock(ctx.tx, "provider-payout", `${providerId}:${observation.providerRef}`);
  const [existing] = await ctx.tx.select().from(providerPayouts).where(and(eq(providerPayouts.provider, providerId), eq(providerPayouts.providerRef, observation.providerRef))).limit(1);
  if (existing) {
    if (existing.currency !== observation.currency || existing.amountMinor !== observation.amountMinor) {
      throw new ServiceError("conflict", "The provider changed a payout's currency or amount; reconciliation was stopped.");
    }
    const rank = { pending: 0, in_transit: 1, paid: 2, failed: 2, cancelled: 2 } as const;
    const terminal = existing.status === "failed" || existing.status === "cancelled";
    const regression = rank[observation.status] < rank[existing.status];
    if (existing.providerStatusAt > observation.occurredAt || terminal || regression) return { payout: existing, applied: false };
    const [updated] = await ctx.tx.update(providerPayouts).set({
      status: observation.status,
      expectedAt: observation.expectedAt ?? existing.expectedAt,
      statementRef: observation.statementRef ?? existing.statementRef,
      failureReason: observation.failureReason ?? (observation.status === "failed" ? existing.failureReason : null),
      providerStatusAt: observation.occurredAt,
      paidAt: observation.status === "paid" ? observation.occurredAt : existing.paidAt,
      reconciledAt: observation.status === "failed" || observation.status === "cancelled" ? null : existing.reconciledAt,
    }).where(eq(providerPayouts.id, existing.id)).returning();
    if (existing.status !== observation.status) {
      await ctx.tx.insert(moneyStateEvents).values({ subjectType: "payout", subjectId: existing.id, fromState: existing.status, toState: observation.status, actor: actorString(ctx.actor), reason: "provider_observation", occurredAt: observation.occurredAt });
    }
    return { payout: updated!, applied: true };
  }
  const [created] = await ctx.tx.insert(providerPayouts).values({
    provider: providerId,
    providerRef: observation.providerRef,
    status: observation.status,
    currency: observation.currency,
    amountMinor: observation.amountMinor,
    statementRef: observation.statementRef,
    failureReason: observation.failureReason,
    expectedAt: observation.expectedAt,
    providerStatusAt: observation.occurredAt,
    paidAt: observation.status === "paid" ? observation.occurredAt : undefined,
  }).returning();
  await ctx.tx.insert(moneyStateEvents).values({ subjectType: "payout", subjectId: created!.id, fromState: null, toState: observation.status, actor: actorString(ctx.actor), reason: "provider_observation", occurredAt: observation.occurredAt });
  return { payout: created!, applied: true };
}

export const recordProviderPayoutObservation = defineService({
  name: "invoicing.recordProviderPayout",
  summary: "Record a webhook or statement-observed provider payout with monotonic event time.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({
    provider,
    providerRef: z.string().trim().min(1).max(500),
    status: z.enum(["pending", "in_transit", "paid", "failed", "cancelled"]),
    currency,
    amountMinor: positiveMinor,
    occurredAt: z.coerce.date(),
    expectedAt: z.coerce.date().optional(),
    statementRef: z.string().trim().min(1).max(500).optional(),
    failureReason: z.string().trim().min(1).max(1_000).optional(),
  }),
  output: z.object({
    payout: providerPayoutRow,
    applied: z.boolean(),
  }),
  handler: async (input, ctx) => {
    if (input.status === "failed" && !input.failureReason) throw new ServiceError("validation", "A failed payout needs a failure reason.");
    const result = await observeProviderPayout(ctx, input.provider, input);
    ctx.queueEvent(`providerPayout.${input.status}`, { payoutId: result.payout.id, provider: input.provider, providerRef: input.providerRef, amountMinor: input.amountMinor, currency: input.currency });
    ctx.setSubject("providerPayout", result.payout.id);
    return result;
  },
});

export const recordProviderBalanceTransaction = defineService({
  name: "invoicing.recordProviderBalanceTransaction",
  summary: "Record an immutable provider gross/fee/net statement line for payout matching.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({
    provider,
    providerRef: z.string().trim().min(1).max(500),
    kind: z.enum(["charge", "refund", "dispute", "fee", "adjustment", "reserve", "release"]),
    sourceType: z.enum(["payment", "refund", "dispute"]).optional(),
    sourceId: z.string().uuid().optional(),
    currency,
    grossMinor: signedMinor,
    feeMinor: minor,
    availableAt: z.coerce.date().optional(),
    occurredAt: z.coerce.date(),
    metadata: boundedObject.default({}),
  }),
  output: providerBalanceTransactionRow,
  handler: async (input, ctx) => {
    const netMinor = input.grossMinor - input.feeMinor;
    if (!Number.isSafeInteger(netMinor)) throw new ServiceError("validation", "The provider net amount is outside Freeholder's safe money range.");
    if (input.grossMinor === 0 && input.feeMinor === 0) throw new ServiceError("validation", "A provider balance transaction cannot be zero.");
    const hash = requestHash({ ...input, netMinor });
    await lock(ctx.tx, "provider-balance-transaction", `${input.provider}:${input.providerRef}`);
    const [existing] = await ctx.tx.select().from(providerBalanceTransactions).where(and(eq(providerBalanceTransactions.provider, input.provider), eq(providerBalanceTransactions.providerRef, input.providerRef))).limit(1);
    if (existing) {
      if (existing.requestHash !== hash) throw new ServiceError("conflict", "That provider balance reference was already recorded with different money.");
      return existing;
    }
    const [created] = await ctx.tx.insert(providerBalanceTransactions).values({ ...input, netMinor, requestHash: hash }).returning();
    ctx.setSubject("providerBalanceTransaction", created!.id);
    return created!;
  },
});

export const reconcileProviderPayout = defineService({
  name: "invoicing.reconcileProviderPayout",
  summary: "Match a payout to immutable provider lines only when their net equals the bank deposit.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({ payoutId: z.string().uuid(), balanceTransactionIds: z.array(z.string().uuid()).min(1).max(10_000) }),
  output: z.object({
    payout: providerPayoutRow,
    transactions: listed(providerBalanceTransactionRow),
    netMinor: z.number().int(),
  }),
  handler: async (input, ctx) => {
    if (new Set(input.balanceTransactionIds).size !== input.balanceTransactionIds.length) throw new ServiceError("validation", "A payout transaction can only be listed once.");
    await lock(ctx.tx, "provider-payout", input.payoutId);
    const [payout] = await ctx.tx.select().from(providerPayouts).where(eq(providerPayouts.id, input.payoutId)).limit(1);
    if (!payout) throw new ServiceError("not_found", "That provider payout is not here.");
    if (payout.status !== "paid") throw new ServiceError("conflict", "Only a provider payout reported paid can reconcile to a bank deposit.");
    const lines = await ctx.tx.select().from(providerBalanceTransactions).where(inArray(providerBalanceTransactions.id, input.balanceTransactionIds));
    if (lines.length !== input.balanceTransactionIds.length) throw new ServiceError("not_found", "One or more provider balance transactions are not here.");
    if (lines.some((line) => line.provider !== payout.provider || line.currency !== payout.currency)) {
      throw new ServiceError("validation", "Every payout line must use the payout's provider and currency.");
    }
    const netMinor = lines.reduce((total, line) => total + line.netMinor, 0);
    if (!Number.isSafeInteger(netMinor) || netMinor !== payout.amountMinor) {
      throw new ServiceError("conflict", `The selected provider lines net to ${netMinor}, not the payout amount ${payout.amountMinor}.`);
    }
    const existing = await ctx.tx.select({ transactionId: providerPayoutItems.balanceTransactionId }).from(providerPayoutItems).where(eq(providerPayoutItems.payoutId, payout.id));
    const existingIds = new Set(existing.map((row) => row.transactionId));
    if (payout.reconciledAt && (existingIds.size !== input.balanceTransactionIds.length || input.balanceTransactionIds.some((id) => !existingIds.has(id)))) {
      throw new ServiceError("conflict", "That payout is already reconciled to a different immutable line set.");
    }
    await ctx.tx.insert(providerPayoutItems).values(input.balanceTransactionIds.map((balanceTransactionId) => ({ payoutId: payout.id, balanceTransactionId }))).onConflictDoNothing();
    const reconciledAt = payout.reconciledAt ?? new Date();
    const [updated] = await ctx.tx.update(providerPayouts).set({ reconciledAt }).where(eq(providerPayouts.id, payout.id)).returning();
    ctx.queueEvent("providerPayout.reconciled", { payoutId: payout.id, provider: payout.provider, amountMinor: payout.amountMinor, currency: payout.currency, transactionCount: lines.length });
    return { payout: updated!, transactions: lines, netMinor };
  },
});

export const listProviderPayouts = defineService({
  name: "invoicing.listProviderPayouts",
  summary: "List provider payouts with reconciliation state and matched net totals.",
  kind: "query",
  permission: "scoped",
  input: z.object({ provider: provider.optional(), status: z.enum(["pending", "in_transit", "paid", "failed", "cancelled"]).optional(), reconciled: z.boolean().optional(), limit: z.number().int().min(1).max(5_000).default(500) }),
  output: listed(
    z.object({
      payout: providerPayoutRow,
      transactions: listed(providerBalanceTransactionRow),
      matchedNetMinor: z.number().int(),
    }),
  ),
  handler: async (input, ctx) => {
    const payouts = await ctx.tx.select().from(providerPayouts).where(and(
      input.provider ? eq(providerPayouts.provider, input.provider) : undefined,
      input.status ? eq(providerPayouts.status, input.status) : undefined,
      input.reconciled === true ? sql`${providerPayouts.reconciledAt} is not null` : input.reconciled === false ? isNull(providerPayouts.reconciledAt) : undefined,
    )).orderBy(desc(providerPayouts.providerStatusAt)).limit(input.limit);
    const payoutIds = payouts.map((row) => row.id);
    const items = payoutIds.length ? await ctx.tx.select({ payoutId: providerPayoutItems.payoutId, transaction: providerBalanceTransactions }).from(providerPayoutItems).innerJoin(providerBalanceTransactions, eq(providerBalanceTransactions.id, providerPayoutItems.balanceTransactionId)).where(inArray(providerPayoutItems.payoutId, payoutIds)) : [];
    return payouts.map((payout) => {
      const transactions = items.filter((item) => item.payoutId === payout.id).map((item) => item.transaction);
      return { payout, transactions, matchedNetMinor: transactions.reduce((total, row) => total + row.netMinor, 0) };
    });
  },
});

export const reconcileAdvancedMoney = defineService({
  name: "invoicing.reconcileAdvancedMoney",
  summary: "Surface customer-balance, payment-plan, and provider-payout discrepancies.",
  kind: "query",
  permission: "scoped",
  input: z.object({ limit: z.number().int().min(1).max(5_000).default(1_000) }),
  output: z.object({
    balanced: z.boolean(),
    checked: z.object({
      customerBalances: z.number().int(),
      paymentPlans: z.number().int(),
      providerPayouts: z.number().int(),
    }),
    discrepancies: listed(
      z.object({
        subjectType: z.enum(["customer_balance", "payment_plan", "provider_payout"]),
        subjectId: uuid,
        recordedMinor: z.number().int(),
        calculatedMinor: z.number().int(),
      }),
    ),
    unassignedProviderLines: listed(providerBalanceTransactionRow),
  }),
  handler: async (input, ctx) => {
    const [accounts, plans, payouts, unassignedProviderLines] = await Promise.all([
      ctx.tx.select().from(customerBalanceAccounts).orderBy(desc(customerBalanceAccounts.updatedAt)).limit(input.limit),
      ctx.tx.select().from(paymentPlans).orderBy(desc(paymentPlans.updatedAt)).limit(input.limit),
      ctx.tx.select().from(providerPayouts).orderBy(desc(providerPayouts.providerStatusAt)).limit(input.limit),
      ctx.tx.select().from(providerBalanceTransactions).leftJoin(providerPayoutItems, eq(providerPayoutItems.balanceTransactionId, providerBalanceTransactions.id)).where(isNull(providerPayoutItems.id)).orderBy(desc(providerBalanceTransactions.occurredAt)).limit(input.limit),
    ]);
    const discrepancies: Array<{ subjectType: "customer_balance" | "payment_plan" | "provider_payout"; subjectId: string; recordedMinor: number; calculatedMinor: number }> = [];
    for (const account of accounts) {
      const entries = await ctx.tx.select().from(customerBalanceEntries).where(eq(customerBalanceEntries.accountId, account.id));
      const calculated = entries.reduce((total, row) => total + row.deltaMinor, 0);
      if (calculated !== account.balanceMinor) discrepancies.push({ subjectType: "customer_balance", subjectId: account.id, recordedMinor: account.balanceMinor, calculatedMinor: calculated });
    }
    for (const plan of plans) {
      const allocations = await ctx.tx.select({ amountMinor: paymentAllocations.amountMinor }).from(paymentAllocations).innerJoin(paymentPlanInstallments, eq(paymentPlanInstallments.id, paymentAllocations.installmentId)).where(eq(paymentPlanInstallments.planId, plan.id));
      const calculated = allocations.reduce((total, row) => total + row.amountMinor, 0);
      if (calculated !== plan.paidMinor) discrepancies.push({ subjectType: "payment_plan", subjectId: plan.id, recordedMinor: plan.paidMinor, calculatedMinor: calculated });
    }
    for (const payout of payouts.filter((row) => row.reconciledAt)) {
      const lines = await ctx.tx.select({ netMinor: providerBalanceTransactions.netMinor }).from(providerPayoutItems).innerJoin(providerBalanceTransactions, eq(providerBalanceTransactions.id, providerPayoutItems.balanceTransactionId)).where(eq(providerPayoutItems.payoutId, payout.id));
      const calculated = lines.reduce((total, row) => total + row.netMinor, 0);
      if (calculated !== payout.amountMinor) discrepancies.push({ subjectType: "provider_payout", subjectId: payout.id, recordedMinor: payout.amountMinor, calculatedMinor: calculated });
    }
    return { balanced: discrepancies.length === 0, checked: { customerBalances: accounts.length, paymentPlans: plans.length, providerPayouts: payouts.length }, discrepancies, unassignedProviderLines: unassignedProviderLines.map((row) => row.provider_balance_transactions) };
  },
});

async function captureBalanceMergeState(tx: Tx, contactIds: string[]) {
  const accounts = await tx.select().from(customerBalanceAccounts).where(inArray(customerBalanceAccounts.contactId, contactIds));
  const accountIds = accounts.map((row) => row.id);
  const entries = accountIds.length ? await tx.select().from(customerBalanceEntries).where(inArray(customerBalanceEntries.accountId, accountIds)) : [];
  return {
    accounts: accounts.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })).sort((a, b) => a.id.localeCompare(b.id)),
    entries: entries.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

const balanceMergeState = z.object({
  accounts: z.array(z.object({
    id: z.string().uuid(),
    contactId: z.string().uuid(),
    currency,
    balanceMinor: minor,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })),
  entries: z.array(z.object({
    id: z.string().uuid(),
    accountId: z.string().uuid(),
    kind: z.enum(["credit", "debit", "refund", "adjustment"]),
    deltaMinor: signedMinor,
    balanceAfterMinor: minor,
    sourceType: z.string(),
    sourceId: z.string().nullable(),
    idempotencyKey: z.string(),
    requestHash: z.string(),
    reason: z.string(),
    actor: z.string(),
    createdAt: z.string().datetime(),
  })),
});

registerContactReference({
  table: "customer_balance_accounts",
  captureForUndo: async (tx, duplicateId, survivingId) => ({ state: await captureBalanceMergeState(tx, [duplicateId, survivingId]), undoable: true }),
  repoint: async (tx, duplicateId, survivingId) => {
    const duplicateAccounts = await tx.select().from(customerBalanceAccounts).where(eq(customerBalanceAccounts.contactId, duplicateId));
    const survivorAccounts = await tx.select().from(customerBalanceAccounts).where(eq(customerBalanceAccounts.contactId, survivingId));
    for (const duplicate of duplicateAccounts) {
      const survivor = survivorAccounts.find((row) => row.currency === duplicate.currency);
      if (!survivor) {
        await tx.update(customerBalanceAccounts).set({ contactId: survivingId }).where(eq(customerBalanceAccounts.id, duplicate.id));
        continue;
      }
      const mergedBalance = survivor.balanceMinor + duplicate.balanceMinor;
      if (!Number.isSafeInteger(mergedBalance)) throw new ServiceError("conflict", "Merged customer credit exceeds the safe money range.");
      await tx.update(customerBalanceEntries).set({ accountId: survivor.id }).where(eq(customerBalanceEntries.accountId, duplicate.id));
      await tx.update(customerBalanceAccounts).set({ balanceMinor: mergedBalance }).where(eq(customerBalanceAccounts.id, survivor.id));
      await tx.delete(customerBalanceAccounts).where(eq(customerBalanceAccounts.id, duplicate.id));
    }
  },
  restoreAfterUndo: async (tx, beforeState, afterState, duplicateId, survivingId) => {
    const before = balanceMergeState.parse(beforeState);
    const after = balanceMergeState.parse(afterState);
    const current = await captureBalanceMergeState(tx, [duplicateId, survivingId]);
    if (canonical(current) !== canonical(after)) {
      throw new ServiceError("conflict", "A customer balance changed after this merge. Leave the merge in place or restore that balance first.");
    }
    const currentById = new Map(current.accounts.map((row) => [row.id, row]));
    for (const account of before.accounts) {
      const values = { contactId: account.contactId, currency: account.currency, balanceMinor: account.balanceMinor, createdAt: new Date(account.createdAt), updatedAt: new Date(account.updatedAt) };
      if (currentById.has(account.id)) await tx.update(customerBalanceAccounts).set(values).where(eq(customerBalanceAccounts.id, account.id));
      else await tx.insert(customerBalanceAccounts).values({ id: account.id, ...values });
    }
    for (const entry of before.entries) {
      await tx.update(customerBalanceEntries).set({ accountId: entry.accountId }).where(eq(customerBalanceEntries.id, entry.id));
    }
  },
});

registerContactPrivacySource({
  scope: "commerce.advanced_money",
  tables: ["customer_balance_accounts", "customer_balance_entries", "payment_plans", "payment_plan_installments", "payment_allocations", "flexible_payments", "late_fee_assessments"],
  exportData: async (tx, contactId) => {
    const ownedInvoices = await tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.contactId, contactId));
    const invoiceIds = ownedInvoices.map((row) => row.id);
    const accounts = await tx.select().from(customerBalanceAccounts).where(eq(customerBalanceAccounts.contactId, contactId));
    const accountIds = accounts.map((row) => row.id);
    const plans = invoiceIds.length ? await tx.select().from(paymentPlans).where(inArray(paymentPlans.invoiceId, invoiceIds)) : [];
    const planIds = plans.map((row) => row.id);
    const installments = planIds.length ? await tx.select().from(paymentPlanInstallments).where(inArray(paymentPlanInstallments.planId, planIds)) : [];
    const installmentIds = installments.map((row) => row.id);
    return {
      customerBalances: accounts,
      customerBalanceEntries: accountIds.length ? await tx.select().from(customerBalanceEntries).where(inArray(customerBalanceEntries.accountId, accountIds)) : [],
      paymentPlans: plans,
      paymentPlanInstallments: installments,
      paymentAllocations: installmentIds.length ? await tx.select().from(paymentAllocations).where(inArray(paymentAllocations.installmentId, installmentIds)) : [],
      flexiblePayments: invoiceIds.length ? await tx.select().from(flexiblePayments).where(inArray(flexiblePayments.invoiceId, invoiceIds)) : [],
      lateFeeAssessments: invoiceIds.length ? await tx.select().from(lateFeeAssessments).where(inArray(lateFeeAssessments.feeInvoiceId, invoiceIds)) : [],
    };
  },
  erase: async (tx, contactId) => {
    const ownedInvoices = await tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.contactId, contactId));
    const invoiceIds = ownedInvoices.map((row) => row.id);
    const accounts = await tx.select({ id: customerBalanceAccounts.id }).from(customerBalanceAccounts).where(eq(customerBalanceAccounts.contactId, contactId));
    const accountIds = accounts.map((row) => row.id);
    let affected = 0;
    if (accountIds.length) {
      affected += (await tx.update(customerBalanceEntries).set({ reason: "Retained accounting record", sourceId: null }).where(inArray(customerBalanceEntries.accountId, accountIds)).returning({ id: customerBalanceEntries.id })).length;
    }
    if (invoiceIds.length) {
      affected += (await tx.update(flexiblePayments).set({ message: null }).where(inArray(flexiblePayments.invoiceId, invoiceIds)).returning({ id: flexiblePayments.id })).length;
      affected += (await tx.update(lateFeeAssessments).set({ reason: "Retained accounting record" }).where(inArray(lateFeeAssessments.feeInvoiceId, invoiceIds)).returning({ id: lateFeeAssessments.id })).length;
    }
    return { affected };
  },
});

export default [
  createDepositAndBalanceInvoices,
  createPaymentPlan,
  getPaymentPlan,
  refreshPaymentPlans,
  cancelPaymentPlan,
  createFlexiblePaymentInvoice,
  assessLateFee,
  adjustCustomerBalance,
  applyCustomerBalance,
  refundCustomerBalancePayment,
  getCustomerBalance,
  recordProviderPayoutObservation,
  recordProviderBalanceTransaction,
  reconcileProviderPayout,
  listProviderPayouts,
  reconcileAdvancedMoney,
];
