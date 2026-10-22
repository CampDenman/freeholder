// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C5.06: provider orchestration and authenticated event convergence.

import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { paymentAdapter, paymentAdapters } from "@/adapters/payments";
import {
  HOSTED_PAYMENT_PROVIDER_IDS,
  LEDGER_PAYMENT_PROVIDER_IDS,
  isHostedPaymentProvider,
} from "@/adapters/payments/providers";
import type { PaymentAdapter, PaymentProviderEvent, SavedPaymentMethodEvidence } from "@/adapters/payments";
import { AdapterError } from "@/adapters/types";
import { contacts } from "@/core/contacts/schema";
import { env } from "@/core/env";
import { listed, row, timestamp, uuid } from "@/core/contract";
import { actorString, defineOrchestratedService, defineService, ServiceError, type ServiceContext, type Tx } from "@/core/service";
import {
  adapterStatus,
  checkoutSession,
  invoiceRow,
  paymentDisputeRow,
  paymentMethodRow,
  paymentProviderEventRow,
  paymentRow,
  providerBalanceTransactionRow,
  providerPayoutRow,
  refundRow,
} from "./contract";
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
import { observeProviderPayout } from "./advanced-money-service";
import {
  invoices,
  moneyStateEvents,
  paymentDisputes,
  paymentMethods,
  paymentProviderCustomers,
  paymentProviderEvents,
  payments,
  providerBalanceTransactions,
  providerPayoutItems,
  providerPayouts,
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
const subscriptionBillingEvent = z.object({
  id: z.string().trim().min(1).max(500),
  kind: z.enum(["subscription_period_paid", "subscription_period_failed", "subscription_cancelled"]),
  providerRef: z.string().trim().min(1).max(500),
  occurredAt: z.string().datetime(),
  amountMinor: positiveMinor.optional(),
  currency: currency.optional(),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
  invoiceProviderRef: z.string().trim().min(1).max(500).optional(),
});
const payoutEvent = z.object({
  id: z.string().trim().min(1).max(500),
  kind: z.enum(["payout_pending", "payout_in_transit", "payout_paid", "payout_failed", "payout_cancelled"]),
  providerRef: z.string().trim().min(1).max(500),
  amountMinor: positiveMinor,
  currency,
  occurredAt: z.string().datetime(),
  expectedAt: z.string().datetime().optional(),
  statementRef: z.string().trim().min(1).max(500).optional(),
  failureReason: z.string().trim().min(1).max(1_000).optional(),
});
const providerEvent = z.union([paymentEvent, refundEvent, disputeEvent, savedMethodEvent, payoutEvent, subscriptionBillingEvent]);

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
): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payment-method:${providerId}:${evidence.providerRef}`}))`);
  const [existing] = await tx
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.provider, providerId), eq(paymentMethods.providerMethodRef, evidence.providerRef)))
    .limit(1);
  if (existing && existing.contactId !== contactId) {
    throw new ServiceError("conflict", "The saved payment method is already linked to a different contact.");
  }
  if (existing && existing.providerStatusAt > occurredAt) return existing.id;
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
    return existing.id;
  } else {
    const [created] = await tx.insert(paymentMethods).values(values).returning({ id: paymentMethods.id });
    return created!.id;
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
        const savedPaymentMethodId = await persistMethod(ctx.tx, providerId, contactId, event.savedMethod, "saved_method_added", new Date(event.occurredAt));
        await ctx.tx.update(payments).set({ metadata: { ...metadata, savedPaymentMethodId } }).where(eq(payments.id, payment.id));
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

async function processPayoutEvent(providerId: string, event: z.infer<typeof payoutEvent>, ctx: ServiceContext): Promise<string> {
  const status = event.kind.slice("payout_".length) as "pending" | "in_transit" | "paid" | "failed" | "cancelled";
  const result = await observeProviderPayout(ctx, providerId, {
    providerRef: event.providerRef,
    status,
    amountMinor: event.amountMinor,
    currency: event.currency,
    occurredAt: new Date(event.occurredAt),
    expectedAt: event.expectedAt ? new Date(event.expectedAt) : undefined,
    statementRef: event.statementRef,
    failureReason: event.failureReason,
  });
  if (result.applied) {
    ctx.queueEvent(`providerPayout.${status}`, { payoutId: result.payout.id, provider: providerId, providerRef: event.providerRef, amountMinor: event.amountMinor, currency: event.currency });
  }
  return result.applied ? event.kind : "payout_older_event_ignored";
}

async function applyEvent(providerId: string, event: PaymentProviderEvent, ctx: ServiceContext): Promise<string> {
  if (event.kind.startsWith("payment_")) return processPaymentEvent(providerId, event as z.infer<typeof paymentEvent>, ctx);
  if (event.kind.startsWith("refund_")) return processRefundEvent(providerId, event as z.infer<typeof refundEvent>, ctx);
  if (event.kind.startsWith("dispute_")) return processDisputeEvent(providerId, event as z.infer<typeof disputeEvent>, ctx);
  if (event.kind.startsWith("payout_")) return processPayoutEvent(providerId, event as z.infer<typeof payoutEvent>, ctx);
  if (event.kind.startsWith("subscription_")) {
    const billing = event as z.infer<typeof subscriptionBillingEvent>;
    const { reconcileProviderPeriod } = await import("@/modules/subscriptions/billing");
    const result = await ctx.callAsSystem(reconcileProviderPeriod, {
      provider: providerId,
      providerRef: billing.providerRef,
      kind: billing.kind,
      amountMinor: billing.amountMinor,
      currency: billing.currency,
      periodStart: billing.periodStart,
      periodEnd: billing.periodEnd,
    });
    return result.applied ? billing.kind : "subscription_event_ignored";
  }
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
  output: z.object({
    processed: z.number().int(),
    duplicates: z.number().int(),
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
  output: listed(
    z.object({
      id: z.string(),
      status: adapterStatus,
      capabilities: z.object({
        refunds: z.boolean(),
        partialRefunds: z.boolean(),
        savedMethods: z.boolean(),
        subscriptions: z.boolean(),
        offSessionCharges: z.boolean(),
        disputes: z.boolean(),
        payouts: z.boolean(),
        inPerson: z.boolean(),
        strongCustomerAuthentication: z.boolean(),
      }),
      methods: listed(
        z.object({
          id: z.string(),
          label: z.string(),
          kind: z.enum([
            "card",
            "wallet",
            "bank_debit",
            "bank_redirect",
            "buy_now_pay_later",
            "cash",
            "bank_transfer",
            "other",
          ]),
          recurring: z.boolean(),
        }),
      ),
      currencySupport: z.string(),
      selected: z.boolean(),
    }),
  ),
  handler: async (input) => Promise.all(paymentAdapters.list().filter((adapter) => adapter.id !== "none").map(async (adapter) => ({
    id: adapter.id,
    status: adapter.status,
    capabilities: adapter.capabilities(),
    methods: await adapter.supportedMethods(input),
    currencySupport: adapter.id === "manual" ? "all_iso_4217" : "provider_account_and_country_dependent",
    selected: adapter.id === paymentAdapter().id,
  }))),
});

const beginCheckoutInput = z.object({
  invoiceId: z.string().uuid(),
  provider,
  amountMinor: positiveMinor.optional(),
  methodIds: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  saveMethod: z.boolean().default(false),
  saveMethodConsent: z.literal(true).optional(),
  successUrl: z.string().url().max(2_000),
  cancelUrl: z.string().url().max(2_000),
  idempotencyKey,
});

/**
 * Provider codes that prove the request was refused outright: nothing was
 * created, and the same idempotency key will replay the same refusal. Any
 * other failure (a concurrent same-key request, a busy reader, a timeout, an
 * outage, an unknown 4xx) may hide an accepted request, so the committed
 * attempt is kept for a same-key retry or reconciliation instead.
 */
const DEFINITE_REFUSALS = new Set([
  "amount_too_large",
  "amount_too_small",
  "email_invalid",
  "parameter_invalid_empty",
  "parameter_invalid_integer",
  "parameter_missing",
  "parameter_unknown",
  "url_invalid",
]);

export function definitiveRefusal(error: unknown): boolean {
  return error instanceof AdapterError && error.code === "invalid_request" &&
    error.providerCode !== undefined && DEFINITE_REFUSALS.has(error.providerCode);
}

/**
 * The provider says this charge has (or would exceed) nothing left to refund:
 * money already went back, through another ledger refund or the provider's
 * own dashboard. That is not an ordinary refusal; it needs owner review.
 */
const ALREADY_REFUNDED = new Set(["charge_already_refunded", "amount_too_large"]);

/** The failure code a refund records for a definite provider refusal, or null when the outcome is uncertain. */
export function refundRefusalCode(error: unknown): "provider_already_refunded" | "provider_refused" | null {
  if (!(error instanceof AdapterError) || error.code !== "invalid_request" || error.providerCode === undefined) return null;
  if (ALREADY_REFUNDED.has(error.providerCode)) return "provider_already_refunded";
  return DEFINITE_REFUSALS.has(error.providerCode) ? "provider_refused" : null;
}

/** Provider idempotency keys expire after 24 hours (Stripe); stop an hour early. */
const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;

/**
 * A same-key retry may contact the provider again only for an attempt that is
 * still open and young enough that the provider will replay, not repeat, it.
 */
export function assertRetryableAttempt(attempt: { status: string; createdAt: Date }, noun: "payment" | "refund"): void {
  if (attempt.status !== "created" && attempt.status !== "processing") {
    throw new ServiceError("conflict", `That ${noun} attempt has already ${attempt.status === "succeeded" ? "succeeded" : `ended as ${attempt.status}`}. Use a new idempotency key for another attempt.`);
  }
  if (Date.now() - attempt.createdAt.getTime() > RETRY_WINDOW_MS) {
    throw new ServiceError("conflict", `That ${noun} attempt is more than 23 hours old. Reconcile it with the provider before trying again.`);
  }
}

/**
 * Orchestrator phases are `permission: "system"`: the public orchestrator has
 * already authorized its caller (grants, scopes, step-up), so its fixed steps
 * run as the system and an API key scoped to the public service needs no
 * grant for steps it could never name. Each mutating phase records who asked
 * in `initiatedBy`, which the audit row keeps with the phase's input.
 */
const initiatedBy = z.string().min(1).max(300);

/** Refunds an owner must check with the provider: still open, or reported as already refunded. */
export const refundNeedsReview = or(
  inArray(refunds.status, ["created", "processing"]),
  and(eq(refunds.status, "failed"), eq(refunds.failureCode, "provider_already_refunded")),
)!;

const OPEN_INVOICE_STATUSES = ["sent", "viewed", "partially_paid", "overdue"];

export const claimPaymentCheckout = defineService({
  name: "invoicing.claimPaymentCheckout",
  summary: "Durably reserve an owner hosted-checkout attempt before contacting its provider.",
  kind: "mutation",
  permission: "system",
  input: beginCheckoutInput.extend({ initiatedBy }),
  output: z.object({ payment: paymentRow, invoice: invoiceRow, email: z.string(), name: z.string(), providerCustomerRef: z.string().nullable() }),
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
    // Idempotent on (provider, key): a retry after a crash or timeout returns
    // this same committed attempt instead of minting a second one.
    const payment = await ctx.call(createPayment, {
      invoiceId: invoice.id,
      provider: input.provider,
      method: "hosted_checkout",
      amountMinor,
      idempotencyKey: input.idempotencyKey,
      metadata: { saveMethodRequested: input.saveMethod, methodIds: input.methodIds },
    });
    // A failed, cancelled or settled attempt is never sent to the provider
    // again, and an old one could outlive the provider's idempotency window.
    assertRetryableAttempt(payment, "payment");
    return { payment, invoice, email: contact.email, name: contact.name, providerCustomerRef: customer?.providerCustomerRef ?? null };
  },
});

export const applyPaymentCheckout = defineService({
  name: "invoicing.applyPaymentCheckout",
  summary: "Attach a provider checkout to its owner payment attempt while the invoice is still open.",
  kind: "mutation",
  permission: "system",
  input: z.object({ paymentId: z.string().uuid(), checkout: checkoutSession, initiatedBy }),
  output: paymentRow,
  handler: async (input, ctx) => {
    const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, input.paymentId)).limit(1);
    if (!payment) throw new ServiceError("not_found", "That payment is not here.");
    // Recheck after provider I/O: the invoice can be paid or closed meanwhile.
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, payment.invoiceId)).limit(1);
    if (!invoice || !OPEN_INVOICE_STATUSES.includes(invoice.status) || invoice.totalMinor - invoice.paidMinor < payment.amountMinor) {
      throw new ServiceError("conflict", "The invoice changed while checkout was opening, so the checkout was not attached. Open the invoice again.");
    }
    return ctx.call(startPayment, {
      id: payment.id,
      providerRef: input.checkout.paymentRef ?? input.checkout.providerRef,
      providerCheckoutRef: input.checkout.providerRef,
    });
  },
});

export const providerPaymentSource = defineService({
  name: "invoicing.providerPaymentSource",
  summary: "Read one payment before an orchestrator contacts its provider.",
  kind: "query",
  permission: "system",
  input: z.object({ paymentId: z.string().uuid() }),
  output: paymentRow,
  handler: async (input, ctx) => {
    const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, input.paymentId)).limit(1);
    if (!payment) throw new ServiceError("not_found", "That payment is not here.");
    return payment;
  },
});

export const recordProviderPaymentResult = defineService({
  name: "invoicing.recordProviderPaymentResult",
  summary: "Settle or fail a payment from the answer its provider gave an orchestrator.",
  kind: "mutation",
  permission: "system",
  input: z.object({
    paymentId: z.string().uuid(),
    initiatedBy,
    outcome: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("settle"), providerRef: z.string().trim().min(1).max(500), processedAt: z.coerce.date().optional() }),
      z.object({ kind: z.literal("fail"), code: z.string().trim().min(1).max(100), message: z.string().trim().min(1).max(500) }),
    ]),
  }),
  output: paymentRow,
  handler: async (input, ctx) => input.outcome.kind === "settle"
    ? ctx.call(settlePayment, { id: input.paymentId, providerRef: input.outcome.providerRef, processedAt: input.outcome.processedAt ?? new Date() })
    : ctx.call(failPayment, { id: input.paymentId, code: input.outcome.code, message: input.outcome.message }),
});

export const claimProviderRefund = defineService({
  name: "invoicing.claimProviderRefund",
  summary: "Reserve a refund amount before an orchestrator asks its provider.",
  kind: "mutation",
  permission: "system",
  input: z.object({ paymentId: z.string().uuid(), amountMinor: positiveMinor, reason: z.string().trim().min(3).max(1_000), idempotencyKey, initiatedBy }),
  output: refundRow,
  handler: async ({ initiatedBy: _initiatedBy, ...input }, ctx) => ctx.call(createRefund, input),
});

export const recordProviderRefundResult = defineService({
  name: "invoicing.recordProviderRefundResult",
  summary: "Settle, start or fail a refund from the answer its provider gave an orchestrator.",
  kind: "mutation",
  permission: "system",
  input: z.object({
    refundId: z.string().uuid(),
    initiatedBy,
    outcome: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("settle"), providerRef: z.string().trim().min(1).max(500) }),
      z.object({ kind: z.literal("start"), providerRef: z.string().trim().min(1).max(500) }),
      z.object({ kind: z.literal("fail"), code: z.string().trim().min(1).max(100), message: z.string().trim().min(1).max(500) }),
    ]),
  }),
  output: refundRow,
  handler: async (input, ctx) => {
    const outcome = input.outcome;
    if (outcome.kind === "settle") return ctx.call(settleRefund, { id: input.refundId, providerRef: outcome.providerRef, processedAt: new Date() });
    if (outcome.kind === "start") return ctx.call(startRefund, { id: input.refundId, providerRef: outcome.providerRef });
    return ctx.call(failRefund, { id: input.refundId, code: outcome.code, message: outcome.message });
  },
});

/** Human-readable failure for a refund the provider definitely refused. */
export function refundRefusalMessage(code: "provider_already_refunded" | "provider_refused", provider: string): string {
  return code === "provider_already_refunded"
    ? `${provider} reports this charge was already refunded. Check the provider and the ledger before refunding again.`
    : `${provider} refused this refund.`;
}

/**
 * C11.10: the attempt commits before provider I/O, the provider is called with
 * no transaction open, and its answer is applied in a fresh one. A crash in
 * between leaves a `created` attempt. For 23 hours a same-key retry replays
 * the provider request and converges; the provider webhook (matched by
 * invoice) also converges it, and `reconcilePaymentProviders` lists it. After
 * that the attempt needs owner reconciliation and a retry is refused.
 */
export const beginPaymentCheckout = defineOrchestratedService({
  name: "invoicing.beginPaymentCheckout",
  summary: "Create one idempotent hosted checkout against an issued invoice.",
  kind: "mutation",
  permission: "scoped",
  input: beginCheckoutInput,
  output: z.object({
    payment: paymentRow,
    checkout: checkoutSession,
  }),
  handler: async (input, caller) => {
    const system = { kind: "system", request: caller.request } as const;
    const by = actorString(caller);
    const successUrl = sameInstanceUrl(input.successUrl);
    const cancelUrl = sameInstanceUrl(input.cancelUrl);
    const source = await claimPaymentCheckout.call({ ...input, initiatedBy: by }, system);
    const { payment, invoice } = source;
    let checkout: z.infer<typeof checkoutSession>;
    try {
      checkout = await paymentAdapter(input.provider).createCheckout({
        invoiceId: invoice.id,
        invoiceNumber: invoice.number!,
        contactId: invoice.contactId,
        currency: invoice.currency,
        amountMinor: payment.amountMinor,
        description: `Invoice ${invoice.number}`,
        customer: { email: source.email, name: source.name },
        successUrl,
        cancelUrl,
        idempotencyKey: input.idempotencyKey,
        methodIds: input.methodIds,
        saveMethod: input.saveMethod,
        providerCustomerRef: source.providerCustomerRef ?? undefined,
      });
    } catch (error) {
      if (definitiveRefusal(error) && payment.status === "created") {
        await recordProviderPaymentResult.call({ paymentId: payment.id, initiatedBy: by, outcome: { kind: "fail", code: "provider_refused", message: `${input.provider} refused to open this checkout.` } }, system);
      }
      return adapterFailure(error);
    }
    const updated = await applyPaymentCheckout.call({ paymentId: payment.id, checkout, initiatedBy: by }, system);
    return { payment: updated, checkout };
  },
});

export const completePaymentCheckout = defineOrchestratedService({
  name: "invoicing.completePaymentCheckout",
  summary: "Capture or recheck an approved hosted checkout and converge its result.",
  kind: "mutation",
  permission: "scoped",
  input: z.object({ paymentId: z.string().uuid(), idempotencyKey }),
  output: paymentRow,
  handler: async (input, caller) => {
    const system = { kind: "system", request: caller.request } as const;
    const by = actorString(caller);
    const payment = await providerPaymentSource.call({ paymentId: input.paymentId }, system);
    if (payment.status === "succeeded") return payment;
    if (!payment.providerCheckoutRef || !isHostedPaymentProvider(payment.provider)) throw new ServiceError("conflict", "That payment has no hosted checkout to complete.");
    let result: Awaited<ReturnType<PaymentAdapter["captureCheckout"]>>;
    try {
      result = await paymentAdapter(payment.provider).captureCheckout({ checkoutRef: payment.providerCheckoutRef, idempotencyKey: input.idempotencyKey });
    } catch (error) { return adapterFailure(error); }
    assertMovement(payment, result);
    if (result.status === "succeeded") return recordProviderPaymentResult.call({ paymentId: payment.id, initiatedBy: by, outcome: { kind: "settle", providerRef: result.providerRef, processedAt: result.occurredAt ? new Date(result.occurredAt) : undefined } }, system);
    if (result.status === "failed") return recordProviderPaymentResult.call({ paymentId: payment.id, initiatedBy: by, outcome: { kind: "fail", code: "provider_failed", message: `${payment.provider} reported that checkout failed.` } }, system);
    return payment;
  },
});

export const submitProviderRefund = defineOrchestratedService({
  name: "invoicing.submitProviderRefund",
  summary: "Submit an idempotent provider refund through the shared refund ledger.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({ paymentId: z.string().uuid(), amountMinor: positiveMinor, reason: z.string().trim().min(3).max(1_000), idempotencyKey }),
  output: refundRow,
  handler: async (input, caller) => {
    const system = { kind: "system", request: caller.request } as const;
    const by = actorString(caller);
    const payment = await providerPaymentSource.call({ paymentId: input.paymentId }, system);
    if (!payment.providerRef || !isHostedPaymentProvider(payment.provider)) throw new ServiceError("conflict", "That payment does not have a refundable hosted-provider settlement.");
    if (!paymentAdapter(payment.provider).capabilities().refunds) throw new ServiceError("conflict", `${payment.provider} refunds are not implemented by this adapter.`);
    // The reservation commits before the provider is asked. A crash after the
    // provider accepted leaves this `created` refund holding the amount, and a
    // same-key retry reuses it rather than reserving (or refunding) twice.
    const refund = await claimProviderRefund.call({ ...input, initiatedBy: by }, system);
    if (refund.status !== "created") return refund;
    assertRetryableAttempt(refund, "refund");
    let result: Awaited<ReturnType<PaymentAdapter["refund"]>>;
    try {
      result = await paymentAdapter(payment.provider).refund({
        paymentId: payment.id,
        providerRef: payment.providerRef,
        currency: payment.currency,
        amountMinor: input.amountMinor,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
      });
    } catch (error) {
      const refused = refundRefusalCode(error);
      if (refused) {
        await recordProviderRefundResult.call({ refundId: refund.id, initiatedBy: by, outcome: { kind: "fail", code: refused, message: refundRefusalMessage(refused, payment.provider) } }, system);
      }
      return adapterFailure(error);
    }
    if (result.status === "succeeded") return recordProviderRefundResult.call({ refundId: refund.id, initiatedBy: by, outcome: { kind: "settle", providerRef: result.providerRef } }, system);
    if (result.status === "failed") return recordProviderRefundResult.call({ refundId: refund.id, initiatedBy: by, outcome: { kind: "fail", code: "provider_failed", message: `${payment.provider} reported that the refund failed.` } }, system);
    return recordProviderRefundResult.call({ refundId: refund.id, initiatedBy: by, outcome: { kind: "start", providerRef: result.providerRef } }, system);
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
  output: paymentRow,
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
  output: refundRow,
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
  output: listed(
    row({
      id: uuid,
      contactId: uuid,
      provider: z.string(),
      kind: z.enum([
        "card",
        "wallet",
        "bank_debit",
        "bank_redirect",
        "buy_now_pay_later",
        "cash",
        "bank_transfer",
        "other",
      ]),
      label: z.string(),
      brand: z.string().nullable(),
      last4: z.string().nullable(),
      expiryMonth: z.number().int().nullable(),
      expiryYear: z.number().int().nullable(),
      status: z.enum(["active", "revoked", "expired"]),
      consentedAt: timestamp,
      revokedAt: timestamp.nullable(),
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  ),
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
  output: listed(
    z.object({
      payment: paymentRow,
      invoiceNumber: z.string().nullable(),
      contactId: uuid,
    }),
  ),
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
  output: z.object({
    payment: paymentRow,
    invoice: invoiceRow,
  }),
  handler: async (input, ctx) => {
    const [row] = await ctx.tx.select({ payment: payments, invoice: invoices }).from(payments).innerJoin(invoices, eq(invoices.id, payments.invoiceId)).where(eq(payments.id, input.id)).limit(1);
    if (!row) throw new ServiceError("not_found", "That payment is not here.");
    return row;
  },
});

export const savedPaymentMethodSource = defineService({
  name: "invoicing.savedPaymentMethodSource",
  summary: "Read one saved payment method before revoking it with its provider.",
  kind: "query",
  permission: "system",
  input: z.object({ id: z.string().uuid() }),
  output: paymentMethodRow,
  handler: async (input, ctx) => {
    const [method] = await ctx.tx.select().from(paymentMethods).where(eq(paymentMethods.id, input.id)).limit(1);
    if (!method) throw new ServiceError("not_found", "That saved payment method is not here.");
    return method;
  },
});

export const applySavedPaymentMethodRevocation = defineService({
  name: "invoicing.applySavedPaymentMethodRevocation",
  summary: "Record that the provider revoked a saved payment method.",
  kind: "mutation",
  permission: "system",
  input: z.object({ id: z.string().uuid(), initiatedBy }),
  output: paymentMethodRow,
  handler: async (input, ctx) => {
    const [method] = await ctx.tx.select().from(paymentMethods).where(eq(paymentMethods.id, input.id)).limit(1).for("update");
    if (!method) throw new ServiceError("not_found", "That saved payment method is not here.");
    if (method.status === "revoked") return method;
    const now = new Date();
    const [updated] = await ctx.tx.update(paymentMethods).set({ status: "revoked", revokedAt: now, providerStatusAt: now }).where(eq(paymentMethods.id, method.id)).returning();
    return updated!;
  },
});

/**
 * Provider revocation is idempotent under its key. A crash after the provider
 * answered leaves the method `active` here until a same-key retry or the
 * provider's `saved_method_removed` event records the revocation.
 */
export const revokeSavedPaymentMethod = defineOrchestratedService({
  name: "invoicing.revokeSavedPaymentMethod",
  summary: "Revoke a provider token and retain only masked revocation evidence.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({ id: z.string().uuid(), idempotencyKey }),
  output: paymentMethodRow,
  handler: async (input, caller) => {
    const system = { kind: "system", request: caller.request } as const;
    const method = await savedPaymentMethodSource.call({ id: input.id }, system);
    if (method.status === "revoked") return method;
    try {
      await paymentAdapter(method.provider).revokeSavedMethod({ providerRef: method.providerMethodRef, idempotencyKey: input.idempotencyKey });
    } catch (error) { return adapterFailure(error); }
    return applySavedPaymentMethodRevocation.call({ id: method.id, initiatedBy: actorString(caller) }, system);
  },
});

export const listPaymentDisputes = defineService({
  name: "invoicing.listPaymentDisputes",
  summary: "List provider-authenticated disputes and evidence deadlines.",
  kind: "query",
  permission: "scoped",
  input: z.object({ status: z.enum(["open", "won", "lost"]).optional(), limit: z.number().int().min(1).max(1_000).default(100) }),
  output: listed(paymentDisputeRow),
  handler: (input, ctx) => ctx.tx.select().from(paymentDisputes).where(input.status ? eq(paymentDisputes.status, input.status) : undefined).orderBy(desc(paymentDisputes.createdAt)).limit(input.limit),
});

export const reconcilePaymentProviders = defineService({
  name: "invoicing.reconcilePaymentProviders",
  summary: "Surface unsettled payments, disputes, payout deposits, fees, and authenticated event evidence.",
  kind: "query",
  permission: "scoped",
  input: z.object({ provider: provider.optional(), limit: z.number().int().min(1).max(5_000).default(1_000) }),
  output: z.object({
    unsettled: listed(paymentRow),
    openDisputes: listed(paymentDisputeRow),
    payouts: listed(providerPayoutRow),
    balanceTransactions: listed(providerBalanceTransactionRow),
    events: listed(paymentProviderEventRow),
    /** Open provider refunds (possibly answered but unrecorded) and refunds the provider says were already made. */
    refundsNeedingReview: listed(refundRow),
  }),
  handler: async (input, ctx) => {
    const providerFilter = input.provider ? eq(payments.provider, input.provider) : inArray(payments.provider, HOSTED_PAYMENT_PROVIDER_IDS);
    const unsettled = await ctx.tx.select().from(payments).where(and(providerFilter, inArray(payments.status, ["created", "processing"]))).orderBy(desc(payments.createdAt)).limit(input.limit);
    const openDisputes = await ctx.tx.select().from(paymentDisputes).where(and(input.provider ? eq(paymentDisputes.provider, input.provider) : undefined, eq(paymentDisputes.status, "open"))).orderBy(desc(paymentDisputes.createdAt)).limit(input.limit);
    const events = await ctx.tx.select().from(paymentProviderEvents).where(input.provider ? eq(paymentProviderEvents.provider, input.provider) : undefined).orderBy(desc(paymentProviderEvents.receivedAt)).limit(input.limit);
    const payouts = await ctx.tx.select().from(providerPayouts).where(and(input.provider ? eq(providerPayouts.provider, input.provider) : undefined, sql`${providerPayouts.reconciledAt} is null`)).orderBy(desc(providerPayouts.providerStatusAt)).limit(input.limit);
    const balanceRows = await ctx.tx.select({ transaction: providerBalanceTransactions }).from(providerBalanceTransactions).leftJoin(providerPayoutItems, eq(providerPayoutItems.balanceTransactionId, providerBalanceTransactions.id)).where(and(input.provider ? eq(providerBalanceTransactions.provider, input.provider) : undefined, isNull(providerPayoutItems.id))).orderBy(desc(providerBalanceTransactions.occurredAt)).limit(input.limit);
    const balanceTransactions = balanceRows.map((row) => row.transaction);
    const refundsNeedingReview = await ctx.tx.select().from(refunds).where(and(
      input.provider ? eq(refunds.provider, input.provider) : inArray(refunds.provider, HOSTED_PAYMENT_PROVIDER_IDS),
      refundNeedsReview,
    )).orderBy(desc(refunds.createdAt)).limit(input.limit);
    return { unsettled, openDisputes, payouts, balanceTransactions, events, refundsNeedingReview };
  },
});

export default [
  // Registered even though the webhook route holds a direct reference: a
  // service that boot has never heard of has no audit entry, no OpenAPI row
  // and no truncation between tests, and "the route imports it" is not the
  // same thing as the registry knowing it exists.
  processPaymentProviderEvents,
  listPaymentProviders,
  claimPaymentCheckout,
  applyPaymentCheckout,
  providerPaymentSource,
  recordProviderPaymentResult,
  claimProviderRefund,
  recordProviderRefundResult,
  beginPaymentCheckout,
  completePaymentCheckout,
  submitProviderRefund,
  recordOfflinePayment,
  recordOfflineRefund,
  listSavedPaymentMethods,
  listPayments,
  getPayment,
  savedPaymentMethodSource,
  applySavedPaymentMethodRevocation,
  revokeSavedPaymentMethod,
  listPaymentDisputes,
  reconcilePaymentProviders,
];
