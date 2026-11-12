// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: complete original-cash inventory, never a truncated absence claim.
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { ServiceError, type ServiceContext } from "@/core/service";
import { subscriptionProviderChargeObservations, subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";
import { merchantFeeObservations, merchantFeeRefunds, merchantPaymentObservations } from "./merchant-collection-schema";
import { assertMerchantCreatorsQuiesced } from "./merchant-payment-request";
import type { MerchantRefundCashOrigin } from "./merchant-refund-origin";
import { merchantCashReturnInspections, merchantCashReturnObservations, merchantCashReturnPrimaryObservations, merchantRefundCreationRefusals, merchantRefundDispatches,
  merchantRefundDispatchFinishes, merchantRefundDispatchStops, merchantRefundObservations, merchantRefundRequests, merchantRefundReservationRetirements, merchantRefundResourceBindings, merchantRefundTerminalReceipts } from "./merchant-refund-schema";
import { merchantTaxDigest } from "./merchant-tax-store";
const MAX = 5000;
const sorted = (rows: readonly object[]) => rows.map(row => merchantTaxDigest(row)).toSorted();
export async function merchantRefundCashHistory(ctx: ServiceContext, cash: MerchantRefundCashOrigin, ownInspectionId?: string): Promise<{
  digest: string; incomplete: boolean; creatorsQuiesced: boolean; feeDebt: boolean;
  refundRequests: Array<{ id: string; amountMinor: number; currency: string; dispatched: boolean; retired: boolean; resourceRefs: string[]; definitelyRefused: boolean }>;
}> {
  const scope = (platform: typeof merchantRefundRequests.providerPlatformAccountId, account: typeof merchantRefundRequests.chargeAccountId) =>
    and(eq(platform, cash.providerPlatformAccountId), sql`${account} is not distinct from ${cash.chargeAccountId}`);
  const requests = await ctx.tx.select().from(merchantRefundRequests).where(and(scope(merchantRefundRequests.providerPlatformAccountId, merchantRefundRequests.chargeAccountId),
    eq(merchantRefundRequests.originalPaymentRef, cash.providerRef))).limit(MAX + 1);
  const ids = requests.map(row => row.id);
  const retirements = ids.length ? await ctx.tx.select().from(merchantRefundReservationRetirements).where(inArray(merchantRefundReservationRetirements.requestId, ids)).limit(MAX + 1) : [];
  const observations = await ctx.tx.select().from(merchantRefundObservations).where(and(
    or(and(eq(merchantRefundObservations.providerPlatformAccountId, cash.providerPlatformAccountId), sql`${merchantRefundObservations.chargeAccountId} is not distinct from ${cash.chargeAccountId}`,
      eq(merchantRefundObservations.paymentProviderRef, cash.providerRef)), ...(ids.length ? [inArray(merchantRefundObservations.requestId, ids)] : []),
      and(isNull(merchantRefundObservations.paymentProviderRef), cash.paymentId ? eq(merchantRefundObservations.paymentId, cash.paymentId) : eq(merchantRefundObservations.subscriptionChargeReceiptId, cash.subscriptionChargeReceiptId!))),
    ownInspectionId ? sql`${merchantRefundObservations.inspectionId} is distinct from ${ownInspectionId}::uuid` : undefined)).limit(MAX + 1);
  const dispatches = ids.length ? await ctx.tx.select().from(merchantRefundDispatches).where(inArray(merchantRefundDispatches.requestId, ids)).limit(MAX + 1) : [];
  const calls = dispatches.map(row => row.id);
  const finishes = calls.length ? await ctx.tx.select().from(merchantRefundDispatchFinishes).where(inArray(merchantRefundDispatchFinishes.dispatchId, calls)).limit(MAX + 1) : [];
  const stops = calls.length ? await ctx.tx.select().from(merchantRefundDispatchStops).where(inArray(merchantRefundDispatchStops.dispatchId, calls)).limit(MAX + 1) : [];
  const refusals = calls.length ? await ctx.tx.select().from(merchantRefundCreationRefusals).where(inArray(merchantRefundCreationRefusals.dispatchId, calls)).limit(MAX + 1) : [];
  const terminals = ids.length ? await ctx.tx.select().from(merchantRefundTerminalReceipts).where(inArray(merchantRefundTerminalReceipts.requestId, ids)).limit(MAX + 1) : [];
  const bindings = ids.length ? await ctx.tx.select().from(merchantRefundResourceBindings).where(inArray(merchantRefundResourceBindings.requestId, ids)).limit(MAX + 1) : [];
  const paymentCash = await ctx.tx.select().from(merchantPaymentObservations).where(and(eq(merchantPaymentObservations.providerPlatformAccountId, cash.providerPlatformAccountId),
    sql`${merchantPaymentObservations.chargeAccountId} is not distinct from ${cash.chargeAccountId}`, eq(merchantPaymentObservations.providerRef, cash.providerRef))).limit(MAX + 1);
  const subscriptionCash = await ctx.tx.select().from(subscriptionProviderChargeObservations).where(and(eq(subscriptionProviderChargeObservations.providerPlatformAccountId, cash.providerPlatformAccountId),
    sql`${subscriptionProviderChargeObservations.chargeAccountId} is not distinct from ${cash.chargeAccountId}`, eq(subscriptionProviderChargeObservations.providerPaymentIntentRef, cash.providerRef))).limit(MAX + 1);
  const receiptRows = await ctx.tx.select().from(subscriptionProviderChargeReceipts).where(and(eq(subscriptionProviderChargeReceipts.providerPlatformAccountId, cash.providerPlatformAccountId),
    sql`${subscriptionProviderChargeReceipts.chargeAccountId} is not distinct from ${cash.chargeAccountId}`, eq(subscriptionProviderChargeReceipts.providerPaymentIntentRef, cash.providerRef))).limit(MAX + 1);
  const receiptIds = receiptRows.map(row => row.id);
  const aliases = receiptIds.length ? await ctx.tx.select().from(merchantAgreementPaymentRoutes).where(inArray(merchantAgreementPaymentRoutes.originalChargeReceiptId, receiptIds)).limit(MAX + 1) : [];
  const paymentIds = [...new Set([...paymentCash.map(row => row.paymentId), ...aliases.map(row => row.paymentId), ...(cash.paymentId ? [cash.paymentId] : [])])];
  const fees = paymentIds.length || receiptIds.length ? await ctx.tx.select().from(merchantFeeRefunds).where(or(
    ...(paymentIds.length ? [inArray(merchantFeeRefunds.paymentId, paymentIds)] : []), ...(receiptIds.length ? [inArray(merchantFeeRefunds.originalChargeReceiptId, receiptIds)] : []))).limit(MAX + 1) : [];
  const feeIds = fees.map(row => row.id);
  const feeObservations = feeIds.length ? await ctx.tx.select().from(merchantFeeObservations).where(inArray(merchantFeeObservations.operationId, feeIds)).limit(MAX + 1) : [];
  const inspectionScope = and(eq(merchantCashReturnInspections.providerPlatformAccountId, cash.providerPlatformAccountId),
    sql`${merchantCashReturnInspections.chargeAccountId} is not distinct from ${cash.chargeAccountId}`, eq(merchantCashReturnInspections.originalPaymentRef, cash.providerRef),
    ownInspectionId ? sql`${merchantCashReturnInspections.id} <> ${ownInspectionId}::uuid` : undefined);
  const otherPrimary = await ctx.tx.select({ observation: merchantCashReturnPrimaryObservations }).from(merchantCashReturnPrimaryObservations)
    .innerJoin(merchantCashReturnInspections, eq(merchantCashReturnInspections.id, merchantCashReturnPrimaryObservations.inspectionId)).where(inspectionScope).limit(MAX + 1);
  const otherReturns = await ctx.tx.select({ observation: merchantCashReturnObservations }).from(merchantCashReturnObservations)
    .innerJoin(merchantCashReturnInspections, eq(merchantCashReturnInspections.id, merchantCashReturnObservations.inspectionId)).where(inspectionScope).limit(MAX + 1);
  const inventory = { requests, retirements, observations, dispatches, finishes, stops, refusals, terminals, bindings, paymentCash, subscriptionCash, receiptRows, aliases, fees, feeObservations, otherPrimary, otherReturns };
  const incomplete = Object.values(inventory).some(rows => rows.length > MAX);
  let creatorsQuiesced = !incomplete && dispatches.every(call => finishes.some(row => row.dispatchId === call.id && row.callerInstanceId === call.caller.id)
    || stops.some(row => row.dispatchId === call.id && row.callerInstanceId === call.caller.id && row.requestDigest === call.requestDigest));
  for (const paymentId of paymentIds) {
    try { await assertMerchantCreatorsQuiesced(ctx, paymentId); }
    catch (error) { if (!(error instanceof ServiceError) || error.code !== "conflict") throw error; creatorsQuiesced = false; }
  }
  // An accepted old projection alone does not prove its physical caller ended.
  // The common fee/reversal caller protocol must supply that separate proof;
  // until composed, any recorded fee operation keeps this return unresolved.
  const feeDebt = fees.length > 0;
  const refundRequests = requests.map(request => {
    const calls = dispatches.filter(row => row.requestId === request.id), known = bindings.filter(row => row.requestId === request.id), acks = known.filter(row => row.origin === "physical_ack");
    return { id: request.id, amountMinor: request.amountMinor, currency: request.currency, dispatched: calls.length > 0,
      retired: calls.length === 0 && retirements.some(row => row.requestId === request.id && row.requestDigest === request.requestDigest),
      resourceRefs: [...new Set((acks.length ? acks : known).map(row => row.providerRef))],
      definitelyRefused: false, // Generic codes/empty lookups do not prove no effect.
    };
  });
  return { refundRequests, digest: merchantTaxDigest(Object.fromEntries(Object.entries(inventory).map(([key, rows]) => [key, sorted(rows)]))), incomplete, creatorsQuiesced, feeDebt };
}
