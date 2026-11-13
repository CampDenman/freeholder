// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: select an explicit protocol at NEW creation, never backfill history.
import { eq, sql } from "drizzle-orm";
import { ServiceError, type ServiceContext } from "@/core/service";
import type { paymentRouting } from "@/modules/invoicing/merchant-charge";
import type { z } from "zod";
import { invoices, payments } from "@/modules/invoicing/schema";
import { subscriptionProrations } from "./proration-schema";
import { subscriptionProrationPaymentProtocols } from "./proration-card-schema";
import { PRORATION_CARD_API_VERSION } from "./proration-card-contract";
export async function captureProrationPaymentProtocol(ctx: ServiceContext, payment: typeof payments.$inferSelect, invoice: typeof invoices.$inferSelect, routing: z.infer<typeof paymentRouting>) {
  if (invoice.sourceType !== "subscription" || invoice.sourceId?.split(":")[1] !== "proration" || !["saved_method", "hosted_checkout"].includes(payment.method)) return;
  const [accepted] = await ctx.tx.select().from(subscriptionProrations).where(eq(subscriptionProrations.debitInvoiceId, invoice.id)).limit(1);
  if (!accepted || invoice.sourceId !== `${accepted.subscriptionId}:proration:${accepted.id}` || payment.provider !== "stripe" || !routing.providerPlatformAccountId
    || payment.status !== "created" || payment.providerRef || payment.providerCheckoutRef) throw new ServiceError("conflict", "Capture only this exact new original proration request's actual selected provider protocol before any caller.");
  await ctx.tx.execute(sql`select set_config('freeholder.proration_card_v1','1',true)`);
  await ctx.tx.insert(subscriptionProrationPaymentProtocols).values({ paymentId: payment.id, prorationId: accepted.id, invoiceId: invoice.id,
    providerApiVersion: routing.providerApiVersion ?? PRORATION_CARD_API_VERSION });
}
export async function originalProrationPaymentProtocol(ctx: ServiceContext, paymentId: string) {
  const [original] = await ctx.tx.select().from(subscriptionProrationPaymentProtocols).where(eq(subscriptionProrationPaymentProtocols.paymentId, paymentId)).limit(1);
  const [source] = await ctx.tx.select({ payment: payments, invoice: invoices }).from(payments).innerJoin(invoices, eq(invoices.id, payments.invoiceId)).where(eq(payments.id, paymentId)).limit(1);
  if (source?.invoice.sourceType === "subscription" && source.invoice.sourceId?.split(":")[1] === "proration" && ["saved_method", "hosted_checkout"].includes(source.payment.method)
    && (!original || original.invoiceId !== source.invoice.id || source.invoice.sourceId.split(":")[2] !== original.prorationId))
    throw new ServiceError("conflict", "Restore the actual first-captured proration protocol; historical unknown requests cannot adopt today's provider API version.");
  return original?.providerApiVersion;
}
