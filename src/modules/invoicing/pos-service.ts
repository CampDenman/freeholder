// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// In-person collection through the POS adapter family (C5.24).
// Cash and Terminal takes become ordinary Payment rows on the invoice.

import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { pointOfSaleAdapter, pointOfSaleAdapters, type PointOfSaleAdapter, type PointOfSalePayment } from "@/adapters/point-of-sale";
import { AdapterError } from "@/adapters/types";
import { listed } from "@/core/contract";
import { listLocations } from "@/core/locations/service";
import { actorString, defineOrchestratedService, defineService, ServiceError } from "@/core/service";
import {
  adapterStatus,
  paymentReceipt,
  paymentRow,
  posCollection,
  refundRow,
} from "./contract";
import {
  createPayment,
  failPayment,
  getPaymentReceipt,
  settlePayment,
  startPayment,
} from "./invoice-service";
import {
  assertRetryableAttempt,
  claimProviderRefund,
  providerPaymentSource,
  recordProviderRefundResult,
  refundNeedsReview,
  refundRefusalCode,
  refundRefusalMessage,
} from "./payment-provider-service";
import { invoices, payments, refunds } from "./schema";

const id = z.string().uuid();
const IN_PERSON_METHODS = ["cash", "card_present", "tap_to_pay"] as const;

function posError(error: unknown): never {
  if (error instanceof AdapterError) {
    throw new ServiceError(error.code === "unavailable" ? "conflict" : "validation", error.message);
  }
  throw error;
}

export const listPointOfSale = defineService({
  name: "invoicing.listPointOfSale",
  summary: "Show in-person adapters, capabilities, and whether they can collect today.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: listed(
    z.object({
      id: z.string(),
      status: adapterStatus,
      capabilities: z.object({
        countertop: z.boolean(),
        tapToPay: z.boolean(),
        cashRecording: z.boolean(),
        refunds: z.boolean(),
      }),
    }),
  ),
  handler: async () =>
    pointOfSaleAdapters
      .list()
      .filter((adapter) => adapter.id !== "none")
      .map((adapter) => ({
        id: adapter.id,
        status: adapter.status,
        capabilities: adapter.capabilities(),
      })),
});

const beginInPersonInput = z.object({
  invoiceId: id,
  locationId: id,
  method: z.enum(IN_PERSON_METHODS),
  amountMinor: z.number().int().positive().optional(),
  readerRef: z.string().trim().min(1).max(200).optional(),
  idempotencyKey: z.string().trim().min(8).max(240),
});

/** Validates the take and, for Terminal, commits its attempt before the reader is contacted. */
export const claimInPersonPayment = defineService({
  name: "invoicing.claimInPersonPayment",
  summary: "Check an in-person take and durably reserve a Terminal attempt before contacting the reader.",
  kind: "mutation",
  // A phase of beginInPersonPayment, which authorized the caller (and its
  // step-up) before running it; `initiatedBy` keeps who asked in the audit.
  permission: "system",
  input: beginInPersonInput.extend({ initiatedBy: z.string().min(1).max(300) }),
  output: z.object({
    invoiceId: id,
    currency: z.string(),
    locationId: id,
    locationName: z.string(),
    amountMinor: z.number().int().positive(),
    payment: paymentRow.nullable(),
  }),
  handler: async (input, ctx) => {
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, input.invoiceId)).limit(1);
    if (!invoice || !invoice.number) throw new ServiceError("not_found", "That issued invoice is not here.");
    const locations = await ctx.callAsSystem(listLocations, { includeHidden: true });
    const location = locations.find((row) => row.id === input.locationId);
    if (!location) throw new ServiceError("not_found", "That location is not here.");
    const amountMinor = input.amountMinor ?? invoice.totalMinor - invoice.paidMinor;
    if (amountMinor <= 0) throw new ServiceError("validation", "That invoice has no outstanding balance.");
    const claimed = { invoiceId: invoice.id, currency: invoice.currency, locationId: location.id, locationName: location.name, amountMinor };
    // Cash needs no external party, so its payment is written once, settled.
    if (input.method === "cash") return { ...claimed, payment: null };

    const adapter = pointOfSaleAdapter("stripe");
    if (!adapter.status.available) throw new ServiceError("conflict", adapter.status.message);
    if (input.method === "tap_to_pay" && !adapter.capabilities().tapToPay) {
      throw new ServiceError("conflict", "Tap-to-pay is not available on this adapter.");
    }
    if (input.method === "card_present" && !adapter.capabilities().countertop) {
      throw new ServiceError("conflict", "A card reader is not available on this adapter.");
    }
    // Idempotent on (provider, key): a retry after a crash reuses this attempt.
    const payment = await ctx.call(createPayment, {
      invoiceId: invoice.id,
      provider: "stripe",
      method: input.method,
      amountMinor,
      idempotencyKey: input.idempotencyKey,
      metadata: {
        inPerson: true,
        locationId: location.id,
        locationName: location.name,
        readerRef: input.readerRef ?? null,
      },
    });
    // Never replay a closed or expired attempt to the reader: a failed take
    // resubmitted under its key could charge again with nowhere to record it.
    assertRetryableAttempt(payment, "payment");
    return { ...claimed, payment };
  },
});

export const applyInPersonPayment = defineService({
  name: "invoicing.applyInPersonPayment",
  summary: "Record what the in-person adapter reported for a claimed take.",
  kind: "mutation",
  permission: "system",
  input: z.object({
    initiatedBy: z.string().min(1).max(300),
    invoiceId: id,
    locationId: id,
    locationName: z.string(),
    method: z.enum(IN_PERSON_METHODS),
    amountMinor: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(8).max(240),
    paymentId: id.optional(),
    collection: posCollection,
  }),
  output: z.object({
    payment: paymentRow,
    collection: posCollection,
    receipt: paymentReceipt.nullable(),
  }),
  handler: async (input, ctx) => {
    const collected = input.collection;
    const payment = input.paymentId
      ? await ctx.call(startPayment, { id: input.paymentId, providerRef: collected.providerRef })
      : await ctx.call(createPayment, {
          invoiceId: input.invoiceId,
          provider: "manual",
          method: "cash",
          amountMinor: input.amountMinor,
          idempotencyKey: input.idempotencyKey,
          metadata: { inPerson: true, locationId: input.locationId, locationName: input.locationName },
        });
    ctx.queueEvent("payment.inPerson", {
      paymentId: payment.id,
      invoiceId: input.invoiceId,
      method: input.method,
      locationId: input.locationId,
    });
    if (collected.status === "succeeded") {
      const settled = await ctx.call(settlePayment, { id: payment.id, providerRef: collected.providerRef });
      const receipt = await ctx.call(getPaymentReceipt, { paymentId: settled.id });
      return { payment: settled, collection: collected, receipt };
    }
    if (collected.status === "failed") {
      const failed = await ctx.call(failPayment, { id: payment.id, code: "provider_failed", message: "The card reader reported that the payment failed." });
      return { payment: failed, collection: collected, receipt: null };
    }
    return { payment, collection: collected, receipt: null };
  },
});

/**
 * C11.10: Terminal collection commits its attempt first, contacts the reader
 * with no transaction open, and records the answer in a fresh one. A crash or
 * reader error in between leaves a `created` in-person payment that
 * `reconcileInPersonPayments` lists; for 23 hours a same-key retry replays the
 * PaymentIntent and converges, after which it needs owner reconciliation.
 */
export const beginInPersonPayment = defineOrchestratedService({
  name: "invoicing.beginInPersonPayment",
  summary: "Collect cash or a Terminal/tap-to-pay take against an issued invoice.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: beginInPersonInput,
  output: z.object({
    payment: paymentRow,
    collection: posCollection,
    receipt: paymentReceipt.nullable(),
  }),
  handler: async (input, caller) => {
    const system = { kind: "system", request: caller.request } as const;
    const by = actorString(caller);
    const claimed = await claimInPersonPayment.call({ ...input, initiatedBy: by }, system);
    const adapter = pointOfSaleAdapter(claimed.payment ? "stripe" : "manual");
    let collected: PointOfSalePayment;
    try {
      collected = await adapter.collect({
        invoiceId: claimed.invoiceId,
        locationId: claimed.locationId,
        currency: claimed.currency,
        amountMinor: claimed.amountMinor,
        idempotencyKey: input.idempotencyKey,
        ...(claimed.payment ? { readerRef: input.readerRef } : {}),
      });
    } catch (error) {
      // Terminal creates the PaymentIntent before it asks the reader, so even
      // a clear refusal (a busy reader, say) can follow a live intent. The
      // attempt stays open for a same-key retry or reconciliation.
      return posError(error);
    }
    return applyInPersonPayment.call({
      initiatedBy: by,
      invoiceId: claimed.invoiceId,
      locationId: claimed.locationId,
      locationName: claimed.locationName,
      method: input.method,
      amountMinor: claimed.amountMinor,
      idempotencyKey: input.idempotencyKey,
      paymentId: claimed.payment?.id,
      collection: collected,
    }, system);
  },
});

export const listInPersonPayments = defineService({
  name: "invoicing.listInPersonPayments",
  summary: "In-person takes for reconciliation and receipts.",
  kind: "query",
  permission: "scoped",
  input: z.object({ limit: z.number().int().min(1).max(500).default(200) }),
  output: listed(paymentRow),
  handler: (input, ctx) =>
    ctx.tx
      .select()
      .from(payments)
      .where(inArray(payments.method, [...IN_PERSON_METHODS]))
      .orderBy(desc(payments.createdAt))
      .limit(input.limit),
});

export const reconcileInPersonPayments = defineService({
  name: "invoicing.reconcileInPersonPayments",
  summary: "Unsettled Terminal takes and succeeded in-person payments that should have receipts.",
  kind: "query",
  permission: "scoped",
  input: z.object({}),
  output: z.object({
    balanced: z.boolean(),
    unsettled: listed(paymentRow),
    /**
     * In-person refunds to check with the provider: accepted but not finished
     * (or their answer was lost), or reported as already refunded.
     */
    refundsNeedingReview: listed(refundRow),
    succeeded: z.number().int(),
    methods: listed(z.enum(["cash", "card_present", "tap_to_pay"])),
  }),
  handler: async (_input, ctx) => {
    const rows = await ctx.tx
      .select()
      .from(payments)
      .where(inArray(payments.method, [...IN_PERSON_METHODS]))
      .orderBy(desc(payments.createdAt))
      .limit(500);
    const unsettled = rows.filter((row) => row.status === "created" || row.status === "processing");
    const succeeded = rows.filter((row) => row.status === "succeeded");
    const refundsNeedingReview = (await ctx.tx
      .select({ refund: refunds })
      .from(refunds)
      .innerJoin(payments, eq(payments.id, refunds.paymentId))
      .where(and(inArray(payments.method, [...IN_PERSON_METHODS]), refundNeedsReview))
      .orderBy(desc(refunds.createdAt))
      .limit(500)).map((row) => row.refund);
    return {
      balanced: unsettled.length === 0 && refundsNeedingReview.length === 0,
      unsettled,
      refundsNeedingReview,
      succeeded: succeeded.length,
      methods: IN_PERSON_METHODS,
    };
  },
});

/**
 * C11.10: the refund reservation commits before the adapter is asked, and the
 * answer is applied in a fresh transaction. A crash in between leaves a
 * `created` refund holding the amount, which a same-key retry converges.
 */
export const refundInPersonPayment = defineOrchestratedService({
  name: "invoicing.refundInPersonPayment",
  summary: "Refund an in-person take through the adapter that collected it.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({
    paymentId: id,
    amountMinor: z.number().int().positive(),
    reason: z.string().trim().min(3).max(1_000),
    idempotencyKey: z.string().trim().min(8).max(240),
  }),
  output: refundRow,
  handler: async (input, caller) => {
    const system = { kind: "system", request: caller.request } as const;
    const by = actorString(caller);
    const payment = await providerPaymentSource.call({ paymentId: input.paymentId }, system);
    if (!IN_PERSON_METHODS.includes(payment.method as (typeof IN_PERSON_METHODS)[number])) {
      throw new ServiceError("conflict", "That payment was not collected in person.");
    }
    const adapter = pointOfSaleAdapter(payment.provider === "stripe" ? "stripe" : "manual");
    const refund = await claimProviderRefund.call({
      paymentId: payment.id,
      amountMinor: input.amountMinor,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      initiatedBy: by,
    }, system);
    if (refund.status !== "created" && refund.status !== "processing") return refund;
    assertRetryableAttempt(refund, "refund");
    let result: Awaited<ReturnType<PointOfSaleAdapter["refund"]>>;
    try {
      result = await adapter.refund({
        providerRef: payment.providerRef ?? payment.id,
        currency: payment.currency,
        amountMinor: input.amountMinor,
        idempotencyKey: input.idempotencyKey,
      });
    } catch (error) {
      const refused = refund.status === "created" ? refundRefusalCode(error) : null;
      if (refused) {
        await recordProviderRefundResult.call({ refundId: refund.id, initiatedBy: by, outcome: { kind: "fail", code: refused, message: refundRefusalMessage(refused, "The in-person adapter") } }, system);
      }
      return posError(error);
    }
    if (result.status === "failed") {
      // Record the refusal (releasing the reservation) before reporting it.
      await recordProviderRefundResult.call({ refundId: refund.id, initiatedBy: by, outcome: { kind: "fail", code: "provider_failed", message: "The in-person adapter refused that refund." } }, system);
      throw new ServiceError("conflict", "The in-person adapter refused that refund.");
    }
    const outcome = result.status === "pending" ? "start" as const : "settle" as const;
    return recordProviderRefundResult.call({ refundId: refund.id, initiatedBy: by, outcome: { kind: outcome, providerRef: result.providerRef } }, system);
  },
});

export default [
  listPointOfSale,
  claimInPersonPayment,
  applyInPersonPayment,
  beginInPersonPayment,
  listInPersonPayments,
  reconcileInPersonPayments,
  refundInPersonPayment,
];
