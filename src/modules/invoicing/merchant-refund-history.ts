// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: complete original-cash inventory, never a truncated absence claim.
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { ServiceError, type ServiceContext } from "@/core/service";
import { subscriptionProviderChargeObservations, subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";
import { merchantFeeObservations, merchantFeeRefunds, merchantPaymentObservations } from "./merchant-collection-schema";
import { assertMerchantCreatorsQuiesced } from "./merchant-payment-request";
import type { MerchantRefundCashOrigin } from "./merchant-refund-origin";
import { merchantCashReturnInspections, merchantCashReturnInspectionFinishes, merchantCashReturnObservations, merchantCashReturnPrimaryObservations, merchantRefundCreationRefusals, merchantRefundDispatches,
  merchantRefundDispatchFinishes, merchantRefundDispatchStops, merchantRefundObservations, merchantRefundRequests, merchantRefundReservationRetirements, merchantRefundResourceBindings, merchantRefundTerminalReceipts } from "./merchant-refund-schema";
import { cashInspectionCallersClosed } from "./merchant-cash-inspection-evidence";
import { cashInspectionStops } from "./merchant-cash-inspection-stops";
import { merchantTaxDigest } from "./merchant-tax-store";
import { merchantRefundObservationCaptures } from "./merchant-refund-current-schema";
import { originalCashCallersFinished, originalCashHistoricalFeesQuiesced, originalCashRecoveryCashWitness } from "./original-cash-recovery-store";
import { controlledCashFinancialHistory } from "./controlled-provider-financial-witness";
const MAX = 5000;
const sorted = (rows: readonly object[]) => rows.map(row => merchantTaxDigest(row)).toSorted();
export async function merchantRefundCashHistory(ctx: ServiceContext, cash: MerchantRefundCashOrigin, ownInspectionId?: string, excludeRecoveryOperationId?: string): Promise<{
  physicalIdentities?: Array<{table:string;id:string}>;
  digest: string; incomplete: boolean; inventoryCount: number; principalCreatorsQuiesced: boolean; creatorsQuiesced: boolean; feeDebt: boolean;
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
      eq(merchantRefundObservations.paymentProviderRef, cash.providerRef)), ...(ids.length ? [inArray(merchantRefundObservations.requestId, ids),inArray(merchantRefundObservations.claimedRequestId, ids)] : []),
      cash.paymentId ? eq(merchantRefundObservations.paymentId, cash.paymentId) : eq(merchantRefundObservations.subscriptionChargeReceiptId, cash.subscriptionChargeReceiptId!)),
    ownInspectionId ? sql`${merchantRefundObservations.inspectionId} is distinct from ${ownInspectionId}::uuid` : undefined)).limit(MAX + 1);
  const observationIds = observations.map(row => row.id);
  const observationCaptures = observationIds.length ? await ctx.tx.select().from(merchantRefundObservationCaptures)
    .where(inArray(merchantRefundObservationCaptures.observationId, observationIds)).limit(MAX + 1) : [];
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
  // Every actual admission is debt before the first callback. Own admission
  // remains in the closure check; only its explicitly composed causal rows are
  // absent from the historical pre-read source digest.
  const inspectionAdmissions=await ctx.tx.select().from(merchantCashReturnInspections).where(and(eq(merchantCashReturnInspections.providerPlatformAccountId,cash.providerPlatformAccountId),
    sql`${merchantCashReturnInspections.chargeAccountId} is not distinct from ${cash.chargeAccountId}`,eq(merchantCashReturnInspections.originalPaymentRef,cash.providerRef))).limit(MAX+1);
  const inspectionIds=inspectionAdmissions.map(row=>row.id),inspectionFinishes=inspectionIds.length?await ctx.tx.select().from(merchantCashReturnInspectionFinishes).where(inArray(merchantCashReturnInspectionFinishes.inspectionId,inspectionIds)).limit(MAX+1):[];
  const inspectionStops=await cashInspectionStops(ctx.tx,inspectionAdmissions),otherInspectionStops=inspectionStops.filter(row=>row.inspectionId!==ownInspectionId);
  const otherInspectionAdmissions=inspectionAdmissions.filter(row=>row.id!==ownInspectionId),otherInspectionFinishes=inspectionFinishes.filter(row=>row.inspectionId!==ownInspectionId);
  const otherPrimary = await ctx.tx.select({ observation: merchantCashReturnPrimaryObservations }).from(merchantCashReturnPrimaryObservations)
    .innerJoin(merchantCashReturnInspections, eq(merchantCashReturnInspections.id, merchantCashReturnPrimaryObservations.inspectionId)).where(inspectionScope).limit(MAX + 1);
  const otherReturns = await ctx.tx.select({ observation: merchantCashReturnObservations }).from(merchantCashReturnObservations)
    .innerJoin(merchantCashReturnInspections, eq(merchantCashReturnInspections.id, merchantCashReturnObservations.inspectionId)).where(inspectionScope).limit(MAX + 1);
  const recovery = await originalCashRecoveryCashWitness(ctx.tx, cash, excludeRecoveryOperationId);
  const controlledParents = paymentIds.length ? await ctx.tx.select({ subscriptionId: merchantAgreementPaymentRoutes.subscriptionId }).from(merchantAgreementPaymentRoutes)
    .where(inArray(merchantAgreementPaymentRoutes.paymentId, paymentIds)).limit(MAX + 1) : [];
  const controlled = await controlledCashFinancialHistory(ctx.tx, receiptIds, controlledParents.map(row => row.subscriptionId));
  const inventory = { requests, retirements, observations, observationCaptures, dispatches, finishes, stops, refusals, terminals, bindings, paymentCash, subscriptionCash, receiptRows, aliases, fees, feeObservations, otherPrimary, otherReturns,
    recoveryOwners: recovery.owners, recoveryOperations: recovery.operations, recoveryFacts: recovery.facts.filter(fact => !["partial_closure", "unassigned_refund_review", "partial_target"].includes(fact.kind)), recoveryFeedback:recovery.feedback, ...(otherInspectionStops.length?{cashInspectionStops:otherInspectionStops}:{}), ...(otherInspectionAdmissions.length||otherInspectionFinishes.length?{cashInspectionAdmissions:otherInspectionAdmissions,cashInspectionFinishes:otherInspectionFinishes}:{}), ...(controlled.entries.length ? { controlledFinancial: controlled.entries } : {}) };
  // Optional INTERNAL counting metadata only for a genuinely controlled
  // graph. It never changes the historical digest or grants safety. Full own
  // caller rows remain present even in a causal historical digest comparison.
  const physicalIdentities = new Map<string, {table:string;id:string}>();
  const controlledScope = controlled.entries.length > 0 || controlled.namespaces.some(row => row.applies);
  const identity = (table:string,id:string) => { physicalIdentities.set(`${table}:${id}`,{table,id}); };
  if(controlledScope){
    for(const row of requests)identity("merchant_refund_requests",row.id);
    for(const row of retirements)identity("merchant_refund_reservation_retirements",row.requestId);
    for(const row of observations)identity("merchant_refund_observations",row.id);
    for(const row of observationCaptures)identity("merchant_refund_observation_captures",row.id);
    for(const row of dispatches)identity("merchant_refund_dispatches",row.id);
    for(const row of finishes)identity("merchant_refund_dispatch_finishes",row.dispatchId);
    for(const row of stops)identity("merchant_refund_dispatch_stops",row.dispatchId);
    for(const row of refusals)identity("merchant_refund_creation_refusals",row.dispatchId);
    for(const row of terminals)identity("merchant_refund_terminal_receipts",row.requestId);
    for(const row of bindings)identity("merchant_refund_resource_bindings",row.id);
    for(const row of paymentCash)identity("merchant_payment_observations",row.id);
    for(const row of subscriptionCash)identity("subscription_provider_charge_observations",row.id);
    for(const row of receiptRows)identity("subscription_provider_charge_receipts",row.id);
    for(const row of aliases)identity("merchant_agreement_payment_routes",row.paymentId);
    for(const row of fees)identity("merchant_fee_refunds",row.id);
    for(const row of feeObservations)identity("merchant_fee_observations",row.id);
    for(const row of inspectionAdmissions)identity("merchant_cash_return_inspections",row.id);
    for(const row of inspectionFinishes)identity("merchant_cash_return_inspection_finishes",row.inspectionId);
    for(const row of inspectionStops)identity("merchant_cash_return_inspection_stops",row.inspectionId);
    for(const row of otherPrimary)identity("merchant_cash_return_primary_observations",row.observation.id);
    for(const row of otherReturns)identity("merchant_cash_return_observations",row.observation.id);
    for(const row of recovery.owners)identity("original_cash_recoveries",row.id);
    for(const row of recovery.operations)identity("original_cash_recovery_operations",row.id);
    for(const row of recovery.facts)identity("original_cash_recovery_facts",row.id);
    for(const row of recovery.closures)identity("original_cash_recovery_closures",row.id);
    for(const row of recovery.feedback)identity("legacy_bank_feedback",row.feedback.id);
    for(const row of controlled.entries)identity(row.table,row.id);
  }
  const inventoryCount = controlledScope ? physicalIdentities.size : Object.values(inventory).reduce((count, rows) => count + rows.length, 0);
  const incomplete = (controlledScope ? inventoryCount : inventoryCount+inspectionAdmissions.length+inspectionFinishes.length+inspectionStops.length-otherInspectionAdmissions.length-otherInspectionFinishes.length-otherInspectionStops.length) > MAX || controlled.incomplete || controlledParents.length > MAX;
  let creatorsQuiesced = !incomplete && !inspectionStops.some(stop=>inspectionFinishes.some(finish=>finish.inspectionId===stop.inspectionId)) && cashInspectionCallersClosed(inspectionAdmissions.filter(row=>!inspectionStops.some(stop=>stop.inspectionId===row.id)),inspectionFinishes) && dispatches.every(call => finishes.some(row => row.dispatchId === call.id && row.callerInstanceId === call.caller.id)
    || stops.some(row => row.dispatchId === call.id && row.callerInstanceId === call.caller.id && row.requestDigest === call.requestDigest));
  for (const paymentId of paymentIds) {
    try { await assertMerchantCreatorsQuiesced(ctx, paymentId); }
    catch (error) { if (!(error instanceof ServiceError) || error.code !== "conflict") throw error; creatorsQuiesced = false; }
  }
  // An accepted old projection alone does not prove its physical caller ended.
  // The common fee/reversal caller protocol must supply that separate proof;
  // until composed, any recorded fee operation keeps this return unresolved.
  const principalCreatorsQuiesced = creatorsQuiesced && !controlled.principalCallerDebt && originalCashCallersFinished({
    operations: recovery.operations.filter(operation => operation.kind === "inspection" && !operation.request.auxiliaryOperationId), facts: recovery.facts,
  });
  creatorsQuiesced &&= !controlled.financialCallerDebt && originalCashCallersFinished(recovery);
  // Old fee journals did not retain a physical process birth/finish. A new
  // explicit hosting review can cover that exact existing operation now;
  // it never fabricates an old caller or changes its accepted cash.
  const feeDebt = !await originalCashHistoricalFeesQuiesced(ctx.tx, cash, fees);
  const refundRequests = requests.map(request => {
    const calls = dispatches.filter(row => row.requestId === request.id), known = bindings.filter(row => row.requestId === request.id), acks = known.filter(row => row.origin === "physical_ack");
    return { id: request.id, amountMinor: request.amountMinor, currency: request.currency, dispatched: calls.length > 0,
      retired: calls.length === 0 && retirements.some(row => row.requestId === request.id && row.requestDigest === request.requestDigest),
      resourceRefs: [...new Set((acks.length ? acks : known).map(row => row.providerRef))],
      definitelyRefused: false, // Generic codes/empty lookups do not prove no effect.
    };
  });
  return { ...(controlledScope?{physicalIdentities:[...physicalIdentities.values()].sort((a,b)=>a.table.localeCompare(b.table)||a.id.localeCompare(b.id))}:{}),refundRequests, inventoryCount, principalCreatorsQuiesced, digest: merchantTaxDigest({ ...Object.fromEntries(Object.entries(inventory).map(([key, rows]) => [key, sorted(rows)])), ...(controlled.entries.length || controlled.namespaces.some(row => row.applies) ? { controlledCoverage: controlled.coverage.map(row => row.revision), controlledNamespaces: controlled.namespaces, ...(controlled.targetCoverage ? { controlledTargetCoverage: controlled.targetCoverage.map(row => row.revision),controlledRawResolution:controlled.rawClassifications?.map(row=>row.revision) } : {}) } : {}) }), incomplete, creatorsQuiesced, feeDebt };
}
