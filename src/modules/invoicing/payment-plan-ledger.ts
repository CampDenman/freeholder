// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// FIFO allocation from the one payment ledger into an invoice's payment plan.

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { actorString, ServiceError, type ServiceContext } from "@/core/service";
import {
  moneyStateEvents,
  paymentAllocations,
  paymentPlanInstallments,
  paymentPlans,
  type payments,
} from "./schema";

type Payment = typeof payments.$inferSelect;

function installmentStatus(
  paidMinor: number,
  amountMinor: number,
  dueAt: Date,
  at: Date,
): "scheduled" | "due" | "partially_paid" | "paid" {
  if (paidMinor === amountMinor) return "paid";
  if (paidMinor > 0) return "partially_paid";
  return dueAt <= at ? "due" : "scheduled";
}

/**
 * Invoice settlement already owns the invoice lock. This adds a plan lock and
 * deterministically allocates the successful payment oldest-due-first.
 */
export async function allocateSettledPayment(
  ctx: ServiceContext,
  payment: Payment,
  processedAt: Date,
): Promise<void> {
  const [plan] = await ctx.tx
    .select()
    .from(paymentPlans)
    .where(and(
      eq(paymentPlans.invoiceId, payment.invoiceId),
      inArray(paymentPlans.status, ["active", "defaulted"]),
    ))
    .limit(1);
  if (!plan) return;

  await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payment-plan:${plan.id}`}))`);
  const existing = await ctx.tx
    .select({ id: paymentAllocations.id })
    .from(paymentAllocations)
    .where(eq(paymentAllocations.paymentId, payment.id))
    .limit(1);
  if (existing.length) return;

  const installments = await ctx.tx
    .select()
    .from(paymentPlanInstallments)
    .where(and(
      eq(paymentPlanInstallments.planId, plan.id),
      inArray(paymentPlanInstallments.status, ["scheduled", "due", "partially_paid", "defaulted"]),
    ))
    .orderBy(asc(paymentPlanInstallments.dueAt), asc(paymentPlanInstallments.position));

  let remaining = payment.amountMinor;
  for (const installment of installments) {
    if (remaining === 0) break;
    const available = installment.amountMinor - installment.paidMinor;
    if (available <= 0) continue;
    const allocated = Math.min(available, remaining);
    const paidMinor = installment.paidMinor + allocated;
    await ctx.tx.insert(paymentAllocations).values({
      paymentId: payment.id,
      installmentId: installment.id,
      amountMinor: allocated,
    });
    await ctx.tx
      .update(paymentPlanInstallments)
      .set({
        paidMinor,
        status: installmentStatus(paidMinor, installment.amountMinor, installment.dueAt, processedAt),
      })
      .where(eq(paymentPlanInstallments.id, installment.id));
    remaining -= allocated;
  }
  if (remaining !== 0) {
    throw new ServiceError("conflict", "The payment plan does not have enough unallocated principal for this settlement.");
  }

  const paidMinor = plan.paidMinor + payment.amountMinor;
  const updatedInstallments = await ctx.tx
    .select()
    .from(paymentPlanInstallments)
    .where(eq(paymentPlanInstallments.planId, plan.id));
  const status = paidMinor === plan.principalMinor
    ? "completed" as const
    : updatedInstallments.some((row) => row.paidMinor < row.amountMinor && row.dueAt < processedAt)
      ? "defaulted" as const
      : "active" as const;
  await ctx.tx
    .update(paymentPlans)
    .set({ paidMinor, status })
    .where(eq(paymentPlans.id, plan.id));
  if (plan.status !== status) {
    await ctx.tx.insert(moneyStateEvents).values({
      subjectType: "payment_plan",
      subjectId: plan.id,
      fromState: plan.status,
      toState: status,
      reason: "payment_allocated",
      actor: actorString(ctx.actor),
      metadata: { paymentId: payment.id, amountMinor: payment.amountMinor },
      occurredAt: processedAt,
    });
  }
}
