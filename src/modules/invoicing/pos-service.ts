// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// In-person collection through the POS adapter family (C5.24).
// Cash and Terminal takes become ordinary Payment rows on the invoice.

import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { pointOfSaleAdapter, pointOfSaleAdapters } from "@/adapters/point-of-sale";
import { AdapterError } from "@/adapters/types";
import { listLocations } from "@/core/locations/service";
import { defineService, ServiceError } from "@/core/service";
import {
  createPayment,
  createRefund,
  getPaymentReceipt,
  settlePayment,
  settleRefund,
  startPayment,
} from "./invoice-service";
import { invoices, payments } from "./schema";

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

export const beginInPersonPayment = defineService({
  name: "invoicing.beginInPersonPayment",
  summary: "Collect cash or a Terminal/tap-to-pay take against an issued invoice.",
  kind: "mutation",
  permission: "scoped",
  stepUp: true,
  input: z.object({
    invoiceId: id,
    locationId: id,
    method: z.enum(IN_PERSON_METHODS),
    amountMinor: z.number().int().positive().optional(),
    readerRef: z.string().trim().min(1).max(200).optional(),
    idempotencyKey: z.string().trim().min(8).max(240),
  }),
  handler: async (input, ctx) => {
    const [invoice] = await ctx.tx.select().from(invoices).where(eq(invoices.id, input.invoiceId)).limit(1);
    if (!invoice || !invoice.number) throw new ServiceError("not_found", "That issued invoice is not here.");
    const locations = await ctx.callAsSystem(listLocations, { includeHidden: true });
    const location = locations.find((row) => row.id === input.locationId);
    if (!location) throw new ServiceError("not_found", "That location is not here.");
    const amountMinor = input.amountMinor ?? invoice.totalMinor - invoice.paidMinor;
    if (amountMinor <= 0) throw new ServiceError("validation", "That invoice has no outstanding balance.");

    if (input.method === "cash") {
      const adapter = pointOfSaleAdapter("manual");
      const collected = await adapter.collect({
        invoiceId: invoice.id,
        locationId: location.id,
        currency: invoice.currency,
        amountMinor,
        idempotencyKey: input.idempotencyKey,
      }).catch(posError);
      const payment = await ctx.call(createPayment, {
        invoiceId: invoice.id,
        provider: "manual",
        method: "cash",
        amountMinor,
        idempotencyKey: input.idempotencyKey,
        metadata: { inPerson: true, locationId: location.id, locationName: location.name },
      });
      const settled = await ctx.call(settlePayment, {
        id: payment.id,
        providerRef: collected.providerRef,
      });
      const receipt = await ctx.call(getPaymentReceipt, { paymentId: settled.id });
      ctx.queueEvent("payment.inPerson", {
        paymentId: settled.id,
        invoiceId: invoice.id,
        method: input.method,
        locationId: location.id,
      });
      return { payment: settled, collection: collected, receipt };
    }

    const adapter = pointOfSaleAdapter("stripe");
    if (!adapter.status.available) throw new ServiceError("conflict", adapter.status.message);
    if (input.method === "tap_to_pay" && !adapter.capabilities().tapToPay) {
      throw new ServiceError("conflict", "Tap-to-pay is not available on this adapter.");
    }
    if (input.method === "card_present" && !adapter.capabilities().countertop) {
      throw new ServiceError("conflict", "A card reader is not available on this adapter.");
    }
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
    const collected = await adapter
      .collect({
        invoiceId: invoice.id,
        locationId: location.id,
        currency: invoice.currency,
        amountMinor,
        idempotencyKey: input.idempotencyKey,
        readerRef: input.readerRef,
      })
      .catch(posError);
    const started = await ctx.call(startPayment, {
      id: payment.id,
      providerRef: collected.providerRef,
    });
    ctx.queueEvent("payment.inPerson", {
      paymentId: started.id,
      invoiceId: invoice.id,
      method: input.method,
      locationId: location.id,
    });
    if (collected.status === "succeeded") {
      const settled = await ctx.call(settlePayment, {
        id: started.id,
        providerRef: collected.providerRef,
      });
      const receipt = await ctx.call(getPaymentReceipt, { paymentId: settled.id });
      return { payment: settled, collection: collected, receipt };
    }
    return { payment: started, collection: collected, receipt: null };
  },
});

export const listInPersonPayments = defineService({
  name: "invoicing.listInPersonPayments",
  summary: "In-person takes for reconciliation and receipts.",
  kind: "query",
  permission: "scoped",
  input: z.object({ limit: z.number().int().min(1).max(500).default(200) }),
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
  handler: async (_input, ctx) => {
    const rows = await ctx.tx
      .select()
      .from(payments)
      .where(inArray(payments.method, [...IN_PERSON_METHODS]))
      .orderBy(desc(payments.createdAt))
      .limit(500);
    const unsettled = rows.filter((row) => row.status === "created" || row.status === "processing");
    const succeeded = rows.filter((row) => row.status === "succeeded");
    return {
      balanced: unsettled.length === 0,
      unsettled,
      succeeded: succeeded.length,
      methods: IN_PERSON_METHODS,
    };
  },
});

export const refundInPersonPayment = defineService({
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
  handler: async (input, ctx) => {
    const [payment] = await ctx.tx.select().from(payments).where(eq(payments.id, input.paymentId)).limit(1);
    if (!payment) throw new ServiceError("not_found", "That payment is not here.");
    if (!IN_PERSON_METHODS.includes(payment.method as (typeof IN_PERSON_METHODS)[number])) {
      throw new ServiceError("conflict", "That payment was not collected in person.");
    }
    const adapterId = payment.provider === "stripe" ? "stripe" : "manual";
    const adapter = pointOfSaleAdapter(adapterId);
    const refund = await ctx.call(createRefund, {
      paymentId: payment.id,
      amountMinor: input.amountMinor,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
    });
    const collected = await adapter
      .refund({
        providerRef: payment.providerRef ?? payment.id,
        currency: payment.currency,
        amountMinor: input.amountMinor,
        idempotencyKey: input.idempotencyKey,
      })
      .catch(posError);
    if (collected.status === "failed") {
      throw new ServiceError("conflict", "The in-person adapter refused that refund.");
    }
    return ctx.call(settleRefund, { id: refund.id, providerRef: collected.providerRef });
  },
});

export default [
  listPointOfSale,
  beginInPersonPayment,
  listInPersonPayments,
  reconcileInPersonPayments,
  refundInPersonPayment,
];
