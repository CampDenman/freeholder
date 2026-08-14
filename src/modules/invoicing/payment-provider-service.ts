// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.06: provider orchestration and authenticated event convergence.

import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { paymentAdapter, paymentAdapters } from "@/adapters/payments";
import {
  HOSTED_PAYMENT_PROVIDER_IDS,
  LEDGER_PAYMENT_PROVIDER_IDS,
  isHostedPaymentProvider,
} from "@/adapters/payments/providers";
import type { PaymentProviderEvent, SavedPaymentMethodEvidence } from "@/adapters/payments";
import { AdapterError } from "@/adapters/types";
import { contacts } from "@/core/contacts/schema";
import { env } from "@/core/env";
import { actorString, defineService, ServiceError, type ServiceContext, type Tx } from "@/core/service";
import {
  cancelPayment,
  createPayment,
  createRefund,
  failPayment,
  failRefund,
  settlePayment,
  settleRefund,
  startPayment,
  startRefund,
} from "./invoice-service";
import {
  invoices,
  moneyStateEvents,
  paymentDisputes,
  paymentMethods,
  paymentProviderCustomers,
  paymentProviderEvents,
  payments,
  refunds,
} from "./schema";

const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);
const positiveMinor = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const idempotencyKey = z.string().trim().min(1).max(240);
const provider = z.enum(HOSTED_PAYMENT_PROVIDER_IDS);
const methodKind = z.enum(["card", "wallet", "bank_debit", "bank_redirect", "buy_now_pay_later", "cash", "bank_transfer", "other"]);
const methodEvidence = z.object({
  providerRef: z.string().trim().min(1).max(500),
  providerCustomerRef: z.string().trim().min(1).max(500).optional(),
  kind: methodKind,
  label: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(100).optional(),
  last4: z.string().trim().regex(/^[A-Za-z0-9]{2,4}$/).optional(),
  expiryMonth: z.number().int().min(1).max(12).optional(),
  expiryYear: z.number().int().min(2000).max(9999).optional(),
});
const paymentEvent = z.object({
  id: z.string().trim().min(1).max(500),
  kind: z.enum(["payment_processing", "payment_succeeded", "payment_failed", "payment_cancelled"]),
  providerRef: z.string().trim().min(1).max(500),
  checkoutRef: z.string().trim().min(1).max(500).optional(),
  amountMinor: positiveMinor.optional(),
  currency: currency.optional(),
  occurredAt: z.string().datetime(),
  invoiceId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  providerCustomerRef: z.string().trim().min(1).max(500).optional(),
  savedMethod: methodEvidence.optional(),
});
const refundEvent = z.object({
  id: z.string().trim().min(1).max(500),
  kind: z.enum(["refund_processing", "refund_succeeded", "refund_failed"]),
  providerRef: z.string().trim().min(1).max(500),
  paymentProviderRef: z.string().trim().min(1).max(500),
  amountMinor: positiveMinor.optional(),
  currency: currency.optional(),
  occurredAt: z.string().datetime(),
});
const disputeEvent = z.object({
  id: z.string().trim().min(1).max(500),
  kind: z.enum(["dispute_opened", "dispute_won", "dispute_lost"]),
  providerRef: z.string().trim().min(1).max(500),
  paymentProviderRef: z.string().trim().min(1).max(500),
  amountMinor: positiveMinor.optional(),
  currency: currency.optional(),
  occurredAt: z.string().datetime(),
  reason: z.string().trim().max(200).optional(),
  evidenceDueAt: z.string().datetime().optional(),
});
const savedMethodEvent = z.object({
  id: z.string().trim().min(1).max(500),
  kind: z.enum(["saved_method_added", "saved_method_removed"]),
  providerCustomerRef: z.string().trim().min(1).max(500).optional(),
  contactId: z.string().uuid().optional(),
  method: methodEvidence,
  occurredAt: z.string().datetime(),
});
const providerEvent = z.union([paymentEvent, refundEvent, disputeEvent, savedMethodEvent]);

function adapterFailure(error: unknown): never {
  if (error instanceof ServiceError) throw error;
  if (error instanceof AdapterError) {
    throw new ServiceError(
      error.code === "rate_limited" ? "rate_limited" : error.code === "invalid_request" ? "validation" : "conflict",
      error.message,
      error.code === "rate_limited" ? 30 : undefined,
    );
  }
  throw error;
}

function sameInstanceUrl(value: string): string {
  let candidate: URL;
  let instance: URL;
  try {
    candidate = new URL(value);
    instance = new URL(env().APP_URL);
  } catch {
    throw new ServiceError("validation", "Checkout return addresses must be valid absolute URLs.");
  }
  if (candidate.origin !== instance.origin) {
    throw new ServiceError("validation", "Checkout return addresses must stay on this Freeholder instance.");
  }
  return candidate.toString();
}

async function paymentByEvent(tx: Tx, providerId: string, event: z.infer<typeof paymentEvent>) {
  const refs = [event.providerRef, event.checkoutRef].filter((value): value is string => Boolean(value));
  const filters = refs.flatMap((ref) => [eq(payments.providerRef, ref), eq(payments.providerCheckoutRef, ref)]);
  let rows = filters.length
    ? await tx.select().from(payments).where(and(eq(payments.provider, providerId), or(...filters))).limit(2)
    : [];
  if (rows.length === 0 && event.invoiceId) {
    rows = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.provider, providerId), eq(payments.invoiceId, event.invoiceId), inArray(payments.status, ["created", "processing"])))
      .orderBy(desc(payments.createdAt))
      .limit(2);
  }
  if (rows.length !== 1) {
    throw new ServiceError("conflict", rows.length === 0 ? "The authenticated provider event arrived before its payment was ready; retry it." : "The provider event matches more than one payment.");
  }
  return rows[0]!;
}

function assertMovement(payment: typeof payments.$inferSelect, event: { amountMinor?: number; currency?: string }): void {
  if (event.amountMinor !== undefined && event.amountMinor !== payment.amountMinor) {
    throw new ServiceError("conflict", "The authenticated provider amount does not match the payment ledger; settlement was refused.");
  }
  if (event.currency !== undefined && event.currency !== payment.currency) {
    throw new ServiceError("conflict", "The authenticated provider currency does not match the payment ledger; settlement was refused.");
  }
}

async function upsertProviderCustomer(tx: Tx, contactId: string, providerId: string, providerCustomerRef?: string): Promise<void> {
  if (!providerCustomerRef) return;
  const [created] = await tx.insert(paymentProviderCustomers).values({ contactId, provider: providerId, providerCustomerRef }).onConflictDoNothing().returning({ id: paymentProviderCustomers.id });
  if (created) return;
  const [existing] = await tx
    .select()
    .from(paymentProviderCustomers)
    .where(and(eq(paymentProviderCustomers.provider, providerId), eq(paymentProviderCustomers.providerCustomerRef, providerCustomerRef)))
    .limit(1);
  if (existing && existing.contactId !== contactId) {
    throw new ServiceError("conflict", "The payment provider customer is already linked to a different contact.");
  }
  if (!existing) throw new ServiceError("conflict", "The payment provider customer could not be linked safely.");
}

async function resolveMethodContact(
  tx: Tx,
  providerId: string,
  explicitContactId?: string,
  providerCustomerRef?: string,
): Promise<string | undefined> {
  if (explicitContactId) {
    const [contact] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, explicitContactId)).limit(1);
    if (contact) return contact.id;
  }
  if (!providerCustomerRef) return undefined;
  const rows = await tx
    .select({ contactId: paymentProviderCustomers.contactId })
    .from(paymentProviderCustomers)
    .where(and(eq(paymentProviderCustomers.provider, providerId), eq(paymentProviderCustomers.providerCustomerRef, providerCustomerRef)))
    .limit(2);
  return rows.length === 1 ? rows[0]!.contactId : undefined;
}

async function persistMethod(
  tx: Tx,
  providerId: string,
  contactId: string,
  evidence: SavedPaymentMethodEvidence,
  kind: "saved_method_added" | "saved_method_removed",
  occurredAt: Date,
): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payment-method:${providerId}:${evidence.providerRef}`}))`);
  const [existing] = await tx
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.provider, providerId), eq(paymentMethods.providerMethodRef, evidence.providerRef)))
    .limit(1);
  if (existing && existing.contactId !== contactId) {
    throw new ServiceError("conflict", "The saved payment method is already linked to a different contact.");
  }
  if (existing && existing.providerStatusAt > occurredAt) return;
  const status = kind === "saved_method_added" ? "active" as const : "revoked" as const;
  const values = {
    contactId,
    provider: providerId,
    providerMethodRef: evidence.providerRef,
    providerCustomerRef: evidence.providerCustomerRef,
    kind: evidence.kind,
    label: evidence.label,
    brand: evidence.brand,
    last4: evidence.last4,
    expiryMonth: evidence.expiryMonth,
    expiryYear: evidence.expiryYear,
    status,
    consentSource: "provider_checkout",
    consentedAt: occurredAt,
    providerStatusAt: occurredAt,
    revokedAt: status === "revoked" ? occurredAt : null,
  };
  if (existing) {
    await tx.update(paymentMethods).set(values).where(eq(paymentMethods.id, existing.id));
  } else {
    await tx.insert(paymentMethods).values(values);
  }
}

async function processPaymentEvent(providerId: string, event: z.infer<typeof paymentEvent>, ctx: ServiceContext): Promise<string> {
  const payment = await paymentByEvent(ctx.tx, providerId, event);
  assertMovement(payment, event);
  if (event.kind === "payment_processing") {
    if (payment.status === "created") {
      await ctx.callAsSystem(startPayment, { id: payment.id, providerRef: event.providerRef, providerCheckoutRef: event.checkoutRef });
      return "payment_processing";
    }
    if (payment.status === "processing" && payment.providerRef !== event.providerRef) {
      await ctx.tx.update(payments).set({ providerRef: event.providerRef, providerCheckoutRef: event.checkoutRef ?? payment.providerCheckoutRef }).where(eq(payments.id, payment.id));
    }
    return `payment_already_${payment.status}`;
  }
  if (event.kind === "payment_succeeded") {
    if (payment.status === "failed" || payment.status === "cancelled") return `payment_terminal_${payment.status}`;
    await ctx.callAsSystem(settlePayment, { id: payment.id, providerRef: event.providerRef, processedAt: new Date(event.occurredAt) });
    const [invoice] = await ctx.tx.select({ contactId: invoices.contactId }).from(invoices).where(eq(invoices.id, payment.invoiceId)).limit(1);
    const contactId = invoice?.contactId ?? event.contactId;
    if (contactId) {
      await upsertProviderCustomer(ctx.tx, contactId, providerId, event.providerCustomerRef ?? event.savedMethod?.providerCustomerRef);
      const metadata = payment.metadata && typeof payment.metadata === "object" && !Array.isArray(payment.metadata) ? payment.metadata as Record<string, unknown> : {};
      if (event.savedMethod && metadata.saveMethodRequested === true) {
        await persistMethod(ctx.tx, providerId, contactId, event.savedMethod, "saved_method_added", new Date(event.occurredAt));
      }
    }
    return "payment_succeeded";
  }
  if (payment.status === "succeeded" || payment.status === "failed" || payment.status === "cancelled") return `payment_terminal_${payment.status}`;
  if (event.kind === "payment_failed") {
    await ctx.callAsSystem(failPayment, { id: payment.id, code: "provider_failed", message: `${providerId} reported that the payment failed.` });
    return "payment_failed";
  }
  await ctx.callAsSystem(cancelPayment, { id: payment.id, reason: `${providerId} reported that checkout was cancelled or expired.` });
  return "payment_cancelled";
}

async function processRefundEvent(providerId: string, event: z.infer<typeof refundEvent>, ctx: ServiceContext): Promise<string> {
  const rows = await ctx.tx
    .select()
    .from(refunds)
    .where(and(eq(refunds.provider, providerId), eq(refunds.providerRef, event.providerRef)))
    .limit(2);
  if (rows.length !== 1) throw new ServiceError("conflict", "The authenticated refund event arrived before its refund was ready; retry it.");
  const refund = rows[0]!;
  if (event.amountMinor !== undefined && event.amountMinor !== refund.amountMinor) throw new ServiceError("conflict", "The authenticated provider refund amount does not match the ledger.");
  if (event.currency !== undefined && event.currency !== refund.currency) throw new ServiceError("conflict", "The authenticated provider refund currency does not match the ledger.");
  if (event.kind === "refund_processing") {
    if (refund.status === "created") await ctx.callAsSystem(startRefund, { id: refund.id, providerRef: event.providerRef });
    return `refund_${refund.status === "created" ? "processing" : refund.status}`;
  }
  if (refund.status === "succeeded" || refund.status === "failed" || refund.status === "cancelled") return `refund_terminal_${refund.status}`;
  if (event.kind === "refund_succeeded") {
    await ctx.callAsSystem(settleRefund, { id: refund.id, providerRef: event.providerRef, processedAt: new Date(event.occurredAt) });
    return "refund_succeeded";
  }
  await ctx.callAsSystem(failRefund, { id: refund.id, code: "provider_failed", message: `${providerId} reported that the refund failed.` });
  return "refund_failed";
}

async function processDisputeEvent(providerId: string, event: z.infer<typeof disputeEvent>, ctx: ServiceContext): Promise<string> {
  const [payment] = await ctx.tx
    .select()
    .from(payments)
    .where(and(eq(payments.provider, providerId), eq(payments.providerRef, event.paymentProviderRef)))
    .limit(1);
  if (!payment) throw new ServiceError("conflict", "The authenticated dispute arrived before its payment was ready; retry it.");
  if (event.amountMinor !== undefined && event.amountMinor > payment.amountMinor) {
    throw new ServiceError("conflict", "The authenticated dispute exceeds the settled payment amount.");
  }
  if (event.currency !== undefined && event.currency !== payment.currency) {
    throw new ServiceError("conflict", "The authenticated dispute currency does not match the settled payment.");
  }
  const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, payment.invoiceId)).limit(1);
  if (!invoice) throw new ServiceError("not_found", "The disputed payment's invoice is not here.");
  const occurredAt = new Date(event.occurredAt);
  await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payment-dispute:${providerId}:${event.providerRef}`}))`);
  const [existing] = await ctx.tx
    .select()
    .from(paymentDisputes)
    .where(and(eq(paymentDisputes.provider, providerId), eq(paymentDisputes.providerRef, event.providerRef)))
    .limit(1);
  if (existing && existing.providerStatusAt > occurredAt) return "dispute_older_event_ignored";
  const status = event.kind === "dispute_opened" ? "open" as const : event.kind === "dispute_won" ? "won" as const : "lost" as const;
  if (existing) {
    await ctx.tx.update(paymentDisputes).set({
      status,
      amountMinor: event.amountMinor ?? existing.amountMinor,
      currency: event.currency ?? existing.currency,
      reason: event.reason ?? existing.reason,
      evidenceDueAt: event.evidenceDueAt ? new Date(event.evidenceDueAt) : existing.evidenceDueAt,
      providerStatusAt: occurredAt,
      closedAt: status === "open" ? null : occurredAt,
    }).where(eq(paymentDisputes.id, existing.id));
    if (existing.status !== status) {
      await ctx.tx.insert(moneyStateEvents).values({ subjectType: "dispute", subjectId: existing.id, fromState: existing.status, toState: status, actor: actorString(ctx.actor), occurredAt });
    }
  } else {
    const [created] = await ctx.tx.insert(paymentDisputes).values({
      paymentId: payment.id,
      invoiceId: invoice.id,
      provider: providerId,
      providerRef: event.providerRef,
      providerPaymentRef: event.paymentProviderRef,
      status,
      currency: event.currency ?? payment.currency,
      amountMinor: event.amountMinor ?? payment.amountMinor,
      reason: event.reason,
      evidenceDueAt: event.evidenceDueAt ? new Date(event.evidenceDueAt) : null,
      openedAt: occurredAt,
      providerStatusAt: occurredAt,
      closedAt: status === "open" ? null : occurredAt,
    }).returning();
    await ctx.tx.insert(moneyStateEvents).values({ subjectType: "dispute", subjectId: created!.id, fromState: null, toState: status, actor: actorString(ctx.actor), occurredAt });
  }
  await ctx.emitTimeline({
    contactId: invoice.contactId,
    eventType: `payment.dispute.${status}`,
    subjectType: "payment",
    subjectId: payment.id,
    payload: { provider: providerId, disputeRef: event.providerRef, amountMinor: event.amountMinor ?? payment.amountMinor, currency: event.currency ?? payment.currency },
  });
  ctx.queueEvent(`payment.dispute.${status}`, { paymentId: payment.id, invoiceId: invoice.id, contactId: invoice.contactId, disputeRef: event.providerRef });
  return `dispute_${status}`;
}

async function processMethodEvent(providerId: string, event: z.infer<typeof savedMethodEvent>, ctx: ServiceContext): Promise<string> {
  const customerRef = event.providerCustomerRef ?? event.method.providerCustomerRef;
  const contactId = await resolveMethodContact(ctx.tx, providerId, event.contactId, customerRef);
  if (!contactId) return "saved_method_without_contact_ignored";
  await upsertProviderCustomer(ctx.tx, contactId, providerId, customerRef);
  await persistMethod(ctx.tx, providerId, contactId, event.method, event.kind, new Date(event.occurredAt));
  return event.kind;
}

async function applyEvent(providerId: string, event: PaymentProviderEvent, ctx: ServiceContext): Promise<string> {
  if (event.kind.startsWith("payment_")) return processPaymentEvent(providerId, event as z.infer<typeof paymentEvent>, ctx);
  if (event.kind.startsWith("refund_")) return processRefundEvent(providerId, event as z.infer<typeof refundEvent>, ctx);
  if (event.kind.startsWith("dispute_")) return processDisputeEvent(providerId, event as z.infer<typeof disputeEvent>, ctx);
  return processMethodEvent(providerId, event as z.infer<typeof savedMethodEvent>, ctx);
}

/** Not registered in API/MCP: only a route that has verified exact raw bytes calls it. */
export const processPaymentProviderEvents = defineService({
  name: "invoicing.processPaymentProviderEvents",
  summary: "Converge authenticated provider events into the money ledger.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    provider,
    bodySha256: z.string().regex(/^[0-9a-f]{64}$/),
    receivedAt: z.string().datetime(),
    events: z.array(providerEvent).max(100),
  }),
  handler: async (input, ctx) => {
    let processed = 0;
    let duplicates = 0;
    for (const event of input.events) {
      const [receipt] = await ctx.tx.insert(paymentProviderEvents).values({
        provider: input.provider,
        providerEventId: event.id,
        kind: event.kind,
        providerObjectRef: "providerRef" in event ? event.providerRef : event.method.providerRef,
        bodySha256: input.bodySha256,
        status: "ignored",
        occurredAt: new Date(event.occurredAt),
        receivedAt: new Date(input.receivedAt),
      }).onConflictDoNothing().returning({ id: paymentProviderEvents.id });
      if (!receipt) {
        duplicates += 1;
        continue;
      }
      const detail = await applyEvent(input.provider, event, ctx);
      await ctx.tx.update(paymentProviderEvents).set({
        status: detail.includes("ignored") || detail.includes("terminal") || detail.includes("already") ? "ignored" : "processed",
        detail: detail.slice(0, 500),
      }).where(eq(paymentProviderEvents.id, receipt.id));
      processed += 1;
    }
    return { processed, duplicates };
  },
});

export const listPaymentProviders = defineService({
  name: "invoicing.listPaymentProviders",
  summary: "Show payment-provider readiness, capabilities, and offered methods without exposing credentials.",
  kind: "query",
  permission: "scoped",
  input: z.object({ country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/), currency, recurring: z.boolean().default(false) }),
  handler: async (input) => Promise.all(paymentAdapters.list().filter((adapter) => adapter.id !== "none").map(async (adapter) => ({
    id: adapter.id,
    status: adapter.status,
    capabilities: adapter.capabilities(),
    methods: await adapter.supportedMethods(input),
    currencySupport: adapter.id === "manual" ? "all_iso_4217" : "provider_account_and_country_dependent",
    selected: adapter.id === paymentAdapter().id,
  }))),
});

export const beginPaymentCheckout = defineService({
  name: "invoicing.beginPaymentCheckout",
  summary: "Create one idempotent hosted checkout against an issued invoice.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({
    invoiceId: z.string().uuid(),
    provider,
    amountMinor: positiveMinor.optional(),
    methodIds: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
    saveMethod: z.boolean().default(false),
    saveMethodConsent: z.literal(true).optional(),
    successUrl: z.string().url().max(2_000),
    cancelUrl: z.string().url().max(2_000),
    idempotencyKey,
  }),
  handler: async (input, ctx) => {
    if (input.saveMethod && input.saveMethodConsent !== true) throw new ServiceError("validation", "Saving a payment method requires the customer's explicit consent.");
    const adapter = paymentAdapter(input.provider);
    if (!adapter.status.available) throw new ServiceError("conflict", adapter.status.message);
    if (input.saveMethod && !adapter.capabilities().savedMethods) {
      throw new ServiceError("conflict", `${input.provider} reusable payment methods are not implemented by this adapter.`);
    }
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, input.invoiceId)).limit(1);
    if (!invoice || !invoice.number) throw new ServiceError("not_found", "That issued invoice is not here.");
    const [contact] = await ctx.tx.select({ id: contacts.id, name: contacts.name, email: contacts.email }).from(contacts).where(eq(contacts.id, invoice.contactId)).limit(1);
    if (!contact?.email) throw new ServiceError("validation", "Hosted checkout needs an email address on the invoice contact.");
    const amountMinor = input.amountMinor ?? invoice.totalMinor - invoice.paidMinor;
    const [customer] = await ctx.tx.select().from(paymentProviderCustomers).where(and(eq(paymentProviderCustomers.contactId, invoice.contactId), eq(paymentProviderCustomers.provider, input.provider))).orderBy(desc(paymentProviderCustomers.updatedAt)).limit(1);
    const providerCustomerRef = customer?.providerCustomerRef;
    const payment = await ctx.call(createPayment, {
      invoiceId: invoice.id,
      provider: input.provider,
      method: "hosted_checkout",
      amountMinor,
      idempotencyKey: input.idempotencyKey,
      metadata: { saveMethodRequested: input.saveMethod, methodIds: input.methodIds },
    });
    try {
      const checkout = await adapter.createCheckout({
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        contactId: invoice.contactId,
        currency: invoice.currency,
        amountMinor,
        description: `Invoice ${invoice.number}`,
        customer: { email: contact.email, name: contact.name },
        successUrl: sameInstanceUrl(input.successUrl),
        cancelUrl: sameInstanceUrl(input.cancelUrl),
        idempotencyKey: input.idempotencyKey,
        methodIds: input.methodIds,
        saveMethod: input.saveMethod,
        providerCustomerRef,
      });
      const updated = await ctx.call(startPayment, {
        id: payment.id,
        providerRef: checkout.paymentRef ?? checkout.providerRef,
        providerCheckoutRef: checkout.providerRef,
      });
      return { payment: updated, checkout };
    } catch (error) { return adapterFailure(error); }
  },
});

export const completePaymentCheckout = defineService({
  name: "invoicing.completePaymentCheckout",
  summary: "Capture or recheck an approved hosted checkout and converge its result.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ paymentId: z.string().uuid(), idempotencyKey }),
  handler: async (input, ctx) => {
    const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, input.paymentId)).limit(1);
    if (!payment) throw new ServiceError("not_found", "That payment is not here.");
    if (payment.status === "succeeded") return payment;
    if (!payment.providerCheckoutRef || !isHostedPaymentProvider(payment.provider)) throw new ServiceError("conflict", "That payment has no hosted checkout to complete.");
    try {
      const result = await paymentAdapter(payment.provider).captureCheckout({ checkoutRef: payment.providerCheckoutRef, idempotencyKey: input.idempotencyKey });
      assertMovement(payment, result);
      if (result.status === "succeeded") return ctx.call(settlePayment, { id: payment.id, providerRef: result.providerRef, processedAt: result.occurredAt ? new Date(result.occurredAt) : new Date() });
      if (result.status === "failed") return ctx.call(failPayment, { id: payment.id, code: "provider_failed", message: `${payment.provider} reported that checkout failed.` });
      return payment;
    } catch (error) { return adapterFailure(error); }
  },
});

export const submitProviderRefund = defineService({
  name: "invoicing.submitProviderRefund",
  summary: "Submit an idempotent provider refund through the shared refund ledger.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({ paymentId: z.string().uuid(), amountMinor: positiveMinor, reason: z.string().trim().min(3).max(1_000), idempotencyKey }),
  handler: async (input, ctx) => {
    const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, input.paymentId)).limit(1);
    if (!payment?.providerRef || !isHostedPaymentProvider(payment.provider)) throw new ServiceError("conflict", "That payment does not have a refundable hosted-provider settlement.");
    if (!paymentAdapter(payment.provider).capabilities().refunds) throw new ServiceError("conflict", `${payment.provider} refunds are not implemented by this adapter.`);
    const refund = await ctx.call(createRefund, input);
    if (refund.status !== "created") return refund;
    try {
      const result = await paymentAdapter(payment.provider).refund({
        paymentId: payment.id,
        providerRef: payment.providerRef,
        currency: payment.currency,
        amountMinor: input.amountMinor,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
      });
      if (result.status === "succeeded") return ctx.call(settleRefund, { id: refund.id, providerRef: result.providerRef, processedAt: new Date() });
      if (result.status === "failed") return ctx.call(failRefund, { id: refund.id, code: "provider_failed", message: `${payment.provider} reported that the refund failed.` });
      return ctx.call(startRefund, { id: refund.id, providerRef: result.providerRef });
    } catch (error) { return adapterFailure(error); }
  },
});

export const recordOfflinePayment = defineService({
  name: "invoicing.recordOfflinePayment",
  summary: "Record owner-attested cash, cheque, transfer, or externally processed money.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({
    invoiceId: z.string().uuid(),
    method: z.enum(["cash", "bank_transfer", "cheque", "external_card", "other"]),
    amountMinor: positiveMinor,
    reference: z.string().trim().min(1).max(300).optional(),
    evidence: z.string().trim().min(3).max(1_000),
    processedAt: z.coerce.date().default(() => new Date()),
    idempotencyKey,
  }),
  handler: async (input, ctx) => {
    const payment = await ctx.call(createPayment, { invoiceId: input.invoiceId, provider: "manual", method: input.method, amountMinor: input.amountMinor, idempotencyKey: input.idempotencyKey, metadata: { evidence: input.evidence, externalReference: input.reference } });
    return ctx.call(settlePayment, { id: payment.id, providerRef: input.reference ? `manual:${input.reference}` : `manual:${payment.id}`, processedAt: input.processedAt });
  },
});

export const recordOfflineRefund = defineService({
  name: "invoicing.recordOfflineRefund",
  summary: "Record an owner-attested offline refund through the shared refund ledger.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({ paymentId: z.string().uuid(), amountMinor: positiveMinor, reason: z.string().trim().min(3).max(1_000), reference: z.string().trim().min(1).max(300).optional(), processedAt: z.coerce.date().default(() => new Date()), idempotencyKey }),
  handler: async (input, ctx) => {
    const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, input.paymentId)).limit(1);
    if (!payment || payment.provider !== "manual") throw new ServiceError("conflict", "Use the payment provider's refund path for a hosted payment.");
    const refund = await ctx.call(createRefund, input);
    return ctx.call(settleRefund, { id: refund.id, providerRef: input.reference ? `manual-refund:${input.reference}` : `manual-refund:${refund.id}`, processedAt: input.processedAt });
  },
});

export const listSavedPaymentMethods = defineService({
  name: "invoicing.listSavedPaymentMethods",
  summary: "List masked, consented payment-method references for one contact.",
  kind: "query",
  permission: "scoped",
  input: z.object({ contactId: z.string().uuid().optional(), includeRevoked: z.boolean().default(false), limit: z.number().int().min(1).max(1_000).default(200) }),
  handler: (input, ctx) => ctx.tx.select({
    id: paymentMethods.id,
    contactId: paymentMethods.contactId,
    provider: paymentMethods.provider,
    kind: paymentMethods.kind,
    label: paymentMethods.label,
    brand: paymentMethods.brand,
    last4: paymentMethods.last4,
    expiryMonth: paymentMethods.expiryMonth,
    expiryYear: paymentMethods.expiryYear,
    status: paymentMethods.status,
    consentedAt: paymentMethods.consentedAt,
    revokedAt: paymentMethods.revokedAt,
    createdAt: paymentMethods.createdAt,
    updatedAt: paymentMethods.updatedAt,
  }).from(paymentMethods).where(and(input.contactId ? eq(paymentMethods.contactId, input.contactId) : undefined, input.includeRevoked ? undefined : eq(paymentMethods.status, "active"))).orderBy(desc(paymentMethods.createdAt)).limit(input.limit),
});

export const listPayments = defineService({
  name: "invoicing.listPayments",
  summary: "List payment attempts with their invoice and contact pointers.",
  kind: "query",
  permission: "scoped",
  input: z.object({
    invoiceId: z.string().uuid().optional(),
    provider: z.enum(LEDGER_PAYMENT_PROVIDER_IDS).optional(),
    status: z.enum(["created", "processing", "succeeded", "failed", "cancelled"]).optional(),
    limit: z.number().int().min(1).max(5_000).default(200),
  }),
  handler: (input, ctx) => ctx.tx.select({
    payment: payments,
    invoiceNumber: invoices.number,
    contactId: invoices.contactId,
  }).from(payments).innerJoin(invoices, eq(invoices.id, payments.invoiceId)).where(and(
    input.invoiceId ? eq(payments.invoiceId, input.invoiceId) : undefined,
    input.provider ? eq(payments.provider, input.provider) : undefined,
    input.status ? eq(payments.status, input.status) : undefined,
  )).orderBy(desc(payments.createdAt)).limit(input.limit),
});

export const getPayment = defineService({
  name: "invoicing.getPayment",
  summary: "Read one payment attempt with its invoice pointer.",
  kind: "query",
  permission: "scoped",
  input: z.object({ id: z.string().uuid() }),
  handler: async (input, ctx) => {
    const [row] = await ctx.tx.select({ payment: payments, invoice: invoices }).from(payments).innerJoin(invoices, eq(invoices.id, payments.invoiceId)).where(eq(payments.id, input.id)).limit(1);
    if (!row) throw new ServiceError("not_found", "That payment is not here.");
    return row;
  },
});

export const revokeSavedPaymentMethod = defineService({
  name: "invoicing.revokeSavedPaymentMethod",
  summary: "Revoke a provider token and retain only masked revocation evidence.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({ id: z.string().uuid(), idempotencyKey }),
  handler: async (input, ctx) => {
    const [method] = await ctx.tx.select().from(paymentMethods).where(eq(paymentMethods.id, input.id)).limit(1);
    if (!method) throw new ServiceError("not_found", "That saved payment method is not here.");
    if (method.status === "revoked") return method;
    try {
      await paymentAdapter(method.provider).revokeSavedMethod({ providerRef: method.providerMethodRef, idempotencyKey: input.idempotencyKey });
    } catch (error) { return adapterFailure(error); }
    const now = new Date();
    const [updated] = await ctx.tx.update(paymentMethods).set({ status: "revoked", revokedAt: now, providerStatusAt: now }).where(eq(paymentMethods.id, method.id)).returning();
    return updated!;
  },
});

export const listPaymentDisputes = defineService({
  name: "invoicing.listPaymentDisputes",
  summary: "List provider-authenticated disputes and evidence deadlines.",
  kind: "query",
  permission: "scoped",
  input: z.object({ status: z.enum(["open", "won", "lost"]).optional(), limit: z.number().int().min(1).max(1_000).default(100) }),
  handler: (input, ctx) => ctx.tx.select().from(paymentDisputes).where(input.status ? eq(paymentDisputes.status, input.status) : undefined).orderBy(desc(paymentDisputes.createdAt)).limit(input.limit),
});

export const reconcilePaymentProviders = defineService({
  name: "invoicing.reconcilePaymentProviders",
  summary: "Surface unsettled hosted payments, open disputes, and authenticated event evidence.",
  kind: "query",
  permission: "scoped",
  input: z.object({ provider: provider.optional(), limit: z.number().int().min(1).max(5_000).default(1_000) }),
  handler: async (input, ctx) => {
    const providerFilter = input.provider ? eq(payments.provider, input.provider) : inArray(payments.provider, HOSTED_PAYMENT_PROVIDER_IDS);
    const unsettled = await ctx.tx.select().from(payments).where(and(providerFilter, inArray(payments.status, ["created", "processing"]))).orderBy(desc(payments.createdAt)).limit(input.limit);
    const openDisputes = await ctx.tx.select().from(paymentDisputes).where(and(input.provider ? eq(paymentDisputes.provider, input.provider) : undefined, eq(paymentDisputes.status, "open"))).orderBy(desc(paymentDisputes.createdAt)).limit(input.limit);
    const events = await ctx.tx.select().from(paymentProviderEvents).where(input.provider ? eq(paymentProviderEvents.provider, input.provider) : undefined).orderBy(desc(paymentProviderEvents.receivedAt)).limit(input.limit);
    return { unsettled, openDisputes, events, limitation: "Provider balance transactions, fees, and payout deposits join this surface in C5.08; this checkpoint reconciles authenticated payment, refund, saved-method, and dispute events." };
  },
});

export default [
  listPaymentProviders,
  beginPaymentCheckout,
  completePaymentCheckout,
  submitProviderRefund,
  recordOfflinePayment,
  recordOfflineRefund,
  listSavedPaymentMethods,
  listPayments,
  getPayment,
  revokeSavedPaymentMethod,
  listPaymentDisputes,
  reconcilePaymentProviders,
];
