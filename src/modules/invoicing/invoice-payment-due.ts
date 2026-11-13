// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// Shared admission limits for customer and original-merchant collection.
import { and, asc, eq } from "drizzle-orm";
import { bookings } from "@/core/scheduling/schema";
import { ServiceError, type ServiceContext } from "@/core/service";
import { checkoutPaymentSchema } from "@/modules/catalog/checkout-policy";
import { orderPaymentMilestones, orders } from "@/modules/catalog/schema";
import { customerCheckoutAllowed } from "./checkout-requirements";
import { invoiceOutstanding } from "./invoice-balance";
import { type invoices, paymentPlans, paymentPlanInstallments } from "./schema";

export async function invoicePaymentDueAmount(invoice: typeof invoices.$inferSelect, ctx: ServiceContext): Promise<number | null> {
  if (!await customerCheckoutAllowed(ctx, invoice)) return null;
  if (invoice.sourceType === "booking" && invoice.sourceId) {
    const [booking] = await ctx.tx.select({status:bookings.status}).from(bookings).where(eq(bookings.id, invoice.sourceId)).limit(1);
    if (!booking || ["cancelled", "no_show"].includes(booking.status)) return null;
  }
  const [plan] = await ctx.tx.select({ id: paymentPlans.id }).from(paymentPlans).where(and(eq(paymentPlans.invoiceId, invoice.id), eq(paymentPlans.status, "active"))).limit(1);
  if (plan) {
    const stages = await ctx.tx.select().from(paymentPlanInstallments).where(eq(paymentPlanInstallments.planId, plan.id)).orderBy(asc(paymentPlanInstallments.position));
    const next = stages.find(stage => !["paid", "waived"].includes(stage.status) && stage.amountMinor > stage.paidMinor);
    return next ? Math.min(next.amountMinor-next.paidMinor, invoiceOutstanding(invoice)) : null;
  }
  if (invoice.sourceType !== "order" || !invoice.sourceId) return invoiceOutstanding(invoice);
  const [order] = await ctx.tx.select({ payment: orders.checkoutPaymentSnapshot })
    .from(orders).where(eq(orders.id, invoice.sourceId)).limit(1);
  if (!order) throw new ServiceError("conflict", "The order linked to this invoice needs the business to review it.");
  if (!order.payment) return invoiceOutstanding(invoice);
  const parsed = checkoutPaymentSchema.safeParse(order.payment);
  if (!parsed.success || (parsed.data.mode === "milestones" && parsed.data.currency !== invoice.currency)) {
    throw new ServiceError("conflict", "This order's payment terms need the business to review them.");
  }
  if (parsed.data.mode === "full") return invoiceOutstanding(invoice);
  const stages = await ctx.tx.select().from(orderPaymentMilestones)
    .where(eq(orderPaymentMilestones.orderId, invoice.sourceId)).orderBy(asc(orderPaymentMilestones.position));
  if (!stages.length || stages.reduce((sum, stage) => sum + stage.amountMinor, 0) !== invoice.totalMinor) {
    throw new ServiceError("conflict", "This order's payment milestones need the business to review them.");
  }
  let cumulative = 0;
  for (const stage of stages) {
    cumulative += stage.amountMinor;
    if (invoice.paidMinor >= cumulative) continue;
    return stage.releasedAt ? cumulative - invoice.paidMinor : null;
  }
  return null;
}

