// Copyright (C) 2026 Tony Aly; SPDX-License-Identifier: Apache-2.0
// C12.38/C9.33: an admitted real receipt crosses the shared payment writer.
import { eq, sql } from "drizzle-orm";
import { ServiceError, type ServiceContext } from "@/core/service";
import { readControlledCashApplicationStage } from "@/modules/invoicing/controlled-cash-application-stage";
import { subscriptionControlledChargeOrigins } from "./controlled-provider-schema";

import { controlledCashBatchPointer } from "./controlled-cash-batch-pointer";
export { CONTROLLED_CASH_BATCH_MARKER,controlledCashBatchPointer } from "./controlled-cash-batch-pointer";
export type ControlledSubscriptionCashPlan = {
  batchId: string; collectionId: string; receiptId: string; admissionDigest: string;
  amountMinor: number; currency: string; feeMinor: number; priorCashMinor: number; priorAllocatedFeeMinor: number;
  applicationProtocol:string;
};
function refuse(): never { throw new ServiceError("conflict", "Restore the genuine same-transaction batch, original receipt and current bank/parent stage before creating its canonical payment. A pointer cannot grant money authority."); }

/** This is the PRE-BIRTH seam: payments.id does not exist yet. The actual
 * shared INSERT alone creates that UUID and its immutable SQL receipt link.
 * The contact/resource/parent/canonical prefix must already be held; the stage
 * authenticates it and this helper never acquires a resource in reverse. */
export async function controlledSubscriptionCashRoute(ctx: ServiceContext, input: { receiptId: string; invoiceId: string; subscriptionId: string }): Promise<ControlledSubscriptionCashPlan> {
  if (ctx.actor.kind !== "system") refuse();
  const [installed] = await ctx.tx.execute<{ ready: boolean }>(sql`select freeholder_controlled_subscription_route_ready() as ready`);
  if (installed?.ready !== true) refuse();
  const [raw] = await ctx.tx.execute<{ pointer: unknown }>(sql`select nullif(current_setting('freeholder.controlled_cash_application_batch_v1',true),'')::jsonb as pointer`);
  const pointer = controlledCashBatchPointer.parse(raw?.pointer);
  if (pointer.receiptId !== input.receiptId) refuse();
  const stage = await readControlledCashApplicationStage(ctx, { batchId: pointer.batchId, receiptId: pointer.receiptId });
  const proof = stage.receipts.find(row => row.receiptId === input.receiptId);
  const [origin] = await ctx.tx.select().from(subscriptionControlledChargeOrigins).where(eq(subscriptionControlledChargeOrigins.receiptId, input.receiptId)).limit(1);
  if (!proof || !origin || stage.batch.digest !== pointer.admissionDigest || stage.batch.collectionId !== pointer.collectionId
    || stage.batch.invoiceId !== input.invoiceId || stage.batch.subscriptionId !== input.subscriptionId
    || origin.resourceId !== stage.batch.resourceId || origin.operationId !== proof.originOperationId
    || origin.callId !== proof.originCallId || origin.factId !== proof.originFactId
    || stage.links.some(link => link.receiptId === input.receiptId) || stage.evidence.paymentId !== null) refuse();
  return { ...pointer, amountMinor: proof.amountMinor, currency: proof.currency, feeMinor: proof.feeMinor,
    priorCashMinor: proof.priorCashMinor, priorAllocatedFeeMinor: proof.priorAllocatedFeeMinor,applicationProtocol:stage.batch.protocol };
}

/** Re-read the actual whole stage after the unchanged shared fee/history
 * readers. No cached scalar or public DTO authorizes a changed namespace. */
export async function recheckControlledSubscriptionCashRoute(ctx: ServiceContext, input: { invoiceId: string; subscriptionId: string; plan: ControlledSubscriptionCashPlan }) {
  const current = await controlledSubscriptionCashRoute(ctx, { ...input, receiptId: input.plan.receiptId });
  const plan = input.plan;
  if (current.batchId !== plan.batchId || current.collectionId !== plan.collectionId || current.receiptId !== plan.receiptId || current.admissionDigest !== plan.admissionDigest
    || current.amountMinor !== plan.amountMinor || current.currency !== plan.currency || current.feeMinor !== plan.feeMinor
    || current.priorCashMinor !== plan.priorCashMinor || current.priorAllocatedFeeMinor !== plan.priorAllocatedFeeMinor||current.applicationProtocol!==plan.applicationProtocol) refuse();
}
