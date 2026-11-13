// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: one physical refund creation, separate actual completion evidence.
import { queueOriginalMerchantRefundRepair } from "./merchant-refund-privacy-repair";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { assertMerchantCreatorsQuiesced } from "./merchant-payment-request";
import { startRefund } from "./invoice-service";
import { merchantPhysicalCaller } from "./merchant-physical-caller";
import { lockMerchantRefundCash } from "./merchant-refund-origin";
import { merchantRefundCapacity } from "./merchant-refund-capacity";
import { originalMerchantRefundCurrentStates, refundObservationHasCurrentBinding } from "./merchant-refund-current-state";
import { STRIPE_REFUND_REFERENCE } from "@/adapters/payments/stripe-refund-reference";
import { assertBankReplacementDispatch } from "./merchant-bank-replacement-store";
import { merchantRefundCreationRefusals, merchantRefundDispatches, merchantRefundDispatchFinishes, merchantRefundDispatchStops, merchantRefundObservations, merchantRefundRequests, merchantRefundReservationRetirements, merchantRefundResourceBindings, merchantRefundTerminalReceipts } from "./merchant-refund-schema";
import { merchantTaxDigest } from "./merchant-tax-store";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
interface LocalFinish { requestId: string; nonce: string; outcome: "returned" | "threw"; providerRef: string | null }
const slot = Symbol.for("freeholder.merchant.refund-caller.v1");
const globalState = globalThis as typeof globalThis & { [slot]?: Map<string, LocalFinish> };
const finished: Map<string, LocalFinish> = globalState[slot] ??= new Map<string, LocalFinish>();
export async function assertMerchantRefundCreatorsQuiesced(ctx: ServiceContext, requestId: string): Promise<void> {
  const rows = await ctx.tx.select({ id: merchantRefundDispatches.id }).from(merchantRefundDispatches)
    .leftJoin(merchantRefundDispatchFinishes, eq(merchantRefundDispatchFinishes.dispatchId, merchantRefundDispatches.id))
    .leftJoin(merchantRefundDispatchStops, eq(merchantRefundDispatchStops.dispatchId, merchantRefundDispatches.id))
    .where(and(eq(merchantRefundDispatches.requestId, requestId), isNull(merchantRefundDispatchFinishes.dispatchId), isNull(merchantRefundDispatchStops.dispatchId))).limit(1);
  if (rows.length) throw new ServiceError("conflict", "The actual original refund creator must finish or have its hosting stop verified before releasing this reservation.");
}
export const claimMerchantRefundDispatch = defineService({
  name: "invoicing.claimMerchantRefundDispatch", summary: "Admit one frozen original refund POST after reconciling all recorded original cash reservations.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", input: z.object({ requestId: z.uuid() }),
  output: z.object({ dispatchId: z.uuid(), completionNonce: z.string() }),
  handler: async ({ requestId }, ctx) => {
    const [snapshot] = await ctx.tx.select().from(merchantRefundRequests).where(eq(merchantRefundRequests.id, requestId));
    if (!snapshot) throw new ServiceError("conflict", "Restore this original refund request before any physical provider work.");
    if (snapshot.refundId) await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`refund:${snapshot.refundId}`}))`);
    await lockMerchantRefundCash(ctx, { ...snapshot, providerRef: snapshot.originalPaymentRef });
    const [original] = await ctx.tx.select().from(merchantRefundRequests).where(eq(merchantRefundRequests.id, requestId)).for("update");
    if (!original || merchantTaxDigest(original.originalRequest) !== original.requestDigest) throw new ServiceError("conflict", "The actual original refund arguments need recovery.");
    if (original.paymentId) await assertMerchantCreatorsQuiesced(ctx, original.paymentId);
    const [retired] = await ctx.tx.select().from(merchantRefundReservationRetirements).where(eq(merchantRefundReservationRetirements.requestId, requestId));
    if (retired) throw new ServiceError("conflict", "This exact original reservation was retired before dispatch and cannot authorize a provider request.");
    const previous = await ctx.tx.select({ id: merchantRefundDispatches.id }).from(merchantRefundDispatches).where(eq(merchantRefundDispatches.requestId, requestId)).limit(1);
    if (previous.length) throw new ServiceError("conflict", "Reconcile the original refund by GET; another creation is never admitted for this request.");
    const requests = await ctx.tx.select().from(merchantRefundRequests).where(and(eq(merchantRefundRequests.providerPlatformAccountId, original.providerPlatformAccountId),
      sql`${merchantRefundRequests.chargeAccountId} is not distinct from ${original.chargeAccountId}`, eq(merchantRefundRequests.originalPaymentRef, original.originalPaymentRef))).limit(5001);
    const ids = requests.map(row => row.id);
    const observations = await ctx.tx.select().from(merchantRefundObservations).where(or(
      and(eq(merchantRefundObservations.providerPlatformAccountId, original.providerPlatformAccountId), sql`${merchantRefundObservations.chargeAccountId} is not distinct from ${original.chargeAccountId}`,
        eq(merchantRefundObservations.paymentProviderRef, original.originalPaymentRef)),
      inArray(merchantRefundObservations.requestId, ids), inArray(merchantRefundObservations.claimedRequestId, ids),
      original.paymentId ? eq(merchantRefundObservations.paymentId, original.paymentId)
        : eq(merchantRefundObservations.subscriptionChargeReceiptId, original.subscriptionChargeReceiptId!))).limit(5001);
    const current = await originalMerchantRefundCurrentStates(ctx, ids);
    if (requests.length > 5000 || observations.length > 5000 || observations.some(row => (row.paymentProviderRef !== original.originalPaymentRef
      || row.providerPlatformAccountId !== original.providerPlatformAccountId || row.chargeAccountId !== original.chargeAccountId || row.providerApiVersion !== original.providerApiVersion)
      && !current.states.some(state => refundObservationHasCurrentBinding(row, state)))
      || requests.some(row => row.originalCashAmountMinor !== original.originalCashAmountMinor || row.currency !== original.currency)) throw new ServiceError("conflict", "Reconcile the complete original refund inventory before dispatch; no truncated or contradictory inventory proves available cash.");
    const retirements = await ctx.tx.select().from(merchantRefundReservationRetirements).where(inArray(merchantRefundReservationRetirements.requestId, ids)).limit(5001);
    const dispatches = await ctx.tx.select({ dispatch: merchantRefundDispatches, finish: merchantRefundDispatchFinishes, stop: merchantRefundDispatchStops, refusal: merchantRefundCreationRefusals })
      .from(merchantRefundDispatches).leftJoin(merchantRefundDispatchFinishes, eq(merchantRefundDispatchFinishes.dispatchId, merchantRefundDispatches.id))
      .leftJoin(merchantRefundDispatchStops, eq(merchantRefundDispatchStops.dispatchId, merchantRefundDispatches.id))
      .leftJoin(merchantRefundCreationRefusals, eq(merchantRefundCreationRefusals.dispatchId, merchantRefundDispatches.id)).where(inArray(merchantRefundDispatches.requestId, ids)).limit(5001);
    const terminal = await ctx.tx.select({ receipt: merchantRefundTerminalReceipts, fact: merchantRefundObservations }).from(merchantRefundTerminalReceipts)
      .innerJoin(merchantRefundObservations, eq(merchantRefundObservations.id, merchantRefundTerminalReceipts.observationId)).where(inArray(merchantRefundTerminalReceipts.requestId, ids)).limit(5001);
    const bindings = await ctx.tx.select().from(merchantRefundResourceBindings).where(inArray(merchantRefundResourceBindings.requestId, ids)).limit(5001);
    if (retirements.length > 5000 || dispatches.length > 5000 || terminal.length > 5000 || bindings.length > 5000) throw new ServiceError("conflict", "The original caller/refund history requires a complete recovery review.");
    const capacity = merchantRefundCapacity({ originalCashMinor: original.originalCashAmountMinor, currency: original.currency,
      reservations: requests.map(request => {
        const calls = dispatches.filter(row => row.dispatch.requestId === request.id);
        const creatorsQuiesced = calls.every(row => row.finish || row.stop);
        const witnesses = bindings.filter(row => row.requestId === request.id), acks = witnesses.filter(row => row.origin === "physical_ack");
        const resources = new Set((acks.length ? acks : witnesses).map(row => row.providerRef));
        const currentState = current.states.find(state => state.requestId === request.id);
        const failed = currentState ? currentState.status === "failed" || currentState.status === "canceled" : resources.size === 1 && terminal.some(row => row.receipt.requestId === request.id && row.fact.requestId === request.id && resources.has(row.fact.providerRef)
          && row.fact.bindingVerified && (row.fact.status === "failed" || row.fact.status === "canceled") && row.fact.providerPlatformAccountId === request.providerPlatformAccountId
          && row.fact.chargeAccountId === request.chargeAccountId && row.fact.providerApiVersion === request.providerApiVersion
          && row.fact.paymentProviderRef === request.originalPaymentRef && row.fact.amountMinor === request.amountMinor && row.fact.currency === request.currency);
        return { id: request.id, amountMinor: request.amountMinor, dispatched: calls.length > 0, creatorsQuiesced,
          terminalFailureVerified: creatorsQuiesced && (calls.length === 0 && retirements.some(row => row.requestId === request.id && row.requestDigest === request.requestDigest) || failed) };
      }), observations: observations.map(row => {
        const proof = current.states.filter(state => refundObservationHasCurrentBinding(row, state));
        return proof.length === 1 ? { ...row, requestId: proof[0]!.requestId, bindingVerified: true } : row;
      }), currentStates: current.states, unresolvedCurrentRequests: current.unresolvedRequestIds });
    if (capacity.availableMinor === null || capacity.availableMinor < 0 || capacity.debt.length) throw new ServiceError("conflict", "Actual unknown, unapplied or contradictory refund money must be reconciled before another dispatch.");
    await assertBankReplacementDispatch(ctx, original);
    const completionNonce = randomBytes(32).toString("base64url");
    await ctx.tx.execute(sql`select set_config('freeholder.merchant_refund_v1','1',true)`);
    const [dispatch] = await ctx.tx.insert(merchantRefundDispatches).values({ requestId, ordinal: 1, requestDigest: original.requestDigest,
      caller: merchantPhysicalCaller(), completionNonceHash: hash(completionNonce) }).returning();
    if (original.refundId) await ctx.callAsSystem(startRefund, { id: original.refundId });
    ctx.setSubject(original.paymentId ? "payment" : "subscription_provider_charge", original.paymentId ?? original.subscriptionChargeReceiptId!);
    return { dispatchId: dispatch!.id, completionNonce };
  },
});
/** Positive physical resource ACK commits even if later money parsing refuses. */
export const recordMerchantRefundResourceAcknowledgement = defineService({
  name: "invoicing.recordMerchantRefundResourceAcknowledgement", summary: "Retain the actual refund resource returned by this exact admitted physical caller.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", auditInputFields: ["dispatchId", "providerRef"],
  input: z.object({ dispatchId: z.uuid(), completionNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/), providerRef: z.string().regex(STRIPE_REFUND_REFERENCE).max(200) }),
  output: z.object({ retained: z.literal(true) }),
  handler: async ({ dispatchId, completionNonce, providerRef }, ctx) => {
    const [dispatch] = await ctx.tx.select().from(merchantRefundDispatches).where(eq(merchantRefundDispatches.id, dispatchId)).for("update");
    const caller = merchantPhysicalCaller();
    if (!dispatch || dispatch.completionNonceHash !== hash(completionNonce) || dispatch.caller.id !== caller.id) throw new ServiceError("permission", "Only the original admitted refund caller can retain its physical ACK.");
    const [request] = await ctx.tx.select().from(merchantRefundRequests).where(eq(merchantRefundRequests.id, dispatch.requestId));
    if (!request || request.requestDigest !== dispatch.requestDigest || merchantTaxDigest(request.originalRequest) !== request.requestDigest) throw new ServiceError("conflict", "Restore the exact original refund arguments before recording this ACK.");
    await ctx.tx.execute(sql`select set_config('freeholder.merchant_refund_v1','1',true)`);
    const evidenceDigest = merchantTaxDigest({ dispatchId, requestDigest: dispatch.requestDigest, callerId: caller.id, providerRef });
    await ctx.tx.insert(merchantRefundResourceBindings).values({ requestId: request.id, dispatchId, providerRef, origin: "physical_ack", evidenceDigest }).onConflictDoNothing();
    const [binding] = await ctx.tx.select({ id: merchantRefundResourceBindings.id }).from(merchantRefundResourceBindings)
      .where(and(eq(merchantRefundResourceBindings.requestId, request.id), eq(merchantRefundResourceBindings.evidenceDigest, evidenceDigest)));
    if (!binding) throw new ServiceError("conflict", "Restore the actual original refund acknowledgement before repair delivery.");
    queueOriginalMerchantRefundRepair(ctx, { kind: "refund_ack", id: binding.id });
    ctx.setSubject(request.paymentId ? "payment" : "subscription_provider_charge", request.paymentId ?? request.subscriptionChargeReceiptId!);
    return { retained: true as const };
  },
});

export const finishMerchantRefundDispatch = defineService({
  name: "invoicing.finishMerchantRefundDispatch", summary: "Retain actual original refund caller completion independently of its returned money status.",
  kind: "mutation", permission: "system", external: false, writeClass: "money", auditInputFields: ["dispatchId"],
  input: z.object({ dispatchId: z.uuid(), completionNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }), output: z.object({ finished: z.literal(true) }),
  handler: async ({ dispatchId, completionNonce }, ctx) => {
    const [dispatch] = await ctx.tx.select().from(merchantRefundDispatches).where(eq(merchantRefundDispatches.id, dispatchId)).for("update");
    const local = finished.get(dispatchId), caller = merchantPhysicalCaller();
    if (!dispatch || !local || local.requestId !== dispatch.requestId || local.nonce !== completionNonce || dispatch.completionNonceHash !== hash(completionNonce) || dispatch.caller.id !== caller.id) throw new ServiceError("permission", "Only this exact original completed refund caller can provide its finish receipt.");
    await ctx.tx.execute(sql`select set_config('freeholder.merchant_refund_v1','1',true)`);
    await ctx.tx.insert(merchantRefundDispatchFinishes).values({ dispatchId, callerInstanceId: caller.id, outcome: local.outcome, providerRef: local.providerRef }).onConflictDoNothing();
    if (local.providerRef) await ctx.tx.insert(merchantRefundResourceBindings).values({ requestId: dispatch.requestId, dispatchId, providerRef: local.providerRef,
      origin: "physical_ack", evidenceDigest: merchantTaxDigest({ dispatchId, requestDigest: dispatch.requestDigest, callerId: caller.id, providerRef: local.providerRef }) }).onConflictDoNothing();
    queueOriginalMerchantRefundRepair(ctx, { kind: "refund_finish", id: dispatchId });
    const [request] = await ctx.tx.select({ paymentId: merchantRefundRequests.paymentId, subscriptionChargeReceiptId: merchantRefundRequests.subscriptionChargeReceiptId }).from(merchantRefundRequests).where(eq(merchantRefundRequests.id, dispatch.requestId));
    if (request) ctx.setSubject(request.paymentId ? "payment" : "subscription_provider_charge", request.paymentId ?? request.subscriptionChargeReceiptId!);
    return { finished: true as const };
  },
});
export async function performMerchantRefundDispatch<T>(dispatch: { dispatchId: string; completionNonce: string }, requestId: string, work: () => Promise<T>): Promise<T> {
  let result: T | undefined, outcome: "returned" | "threw" = "threw";
  try { result = await work(); outcome = "returned"; return result; }
  finally {
    const candidate = result && typeof result === "object" && "providerRef" in result ? result.providerRef : undefined;
    const providerRef = typeof candidate === "string" && candidate.length <= 200 && STRIPE_REFUND_REFERENCE.test(candidate) ? candidate : null;
    finished.set(dispatch.dispatchId, { requestId, nonce: dispatch.completionNonce, outcome, providerRef });
    await finishMerchantRefundDispatch.call(dispatch, { kind: "system" });
    finished.delete(dispatch.dispatchId);
  }
}
export async function flushLocalMerchantRefundDispatchFinishes(requestId: string): Promise<void> {
  for (const [dispatchId, local] of finished) if (local.requestId === requestId) {
    await finishMerchantRefundDispatch.call({ dispatchId, completionNonce: local.nonce }, { kind: "system" }); finished.delete(dispatchId);
  }
}
// Private registration is present; qualification still requires assembled SQL/negative recovery/observer qualification.

export default [claimMerchantRefundDispatch, recordMerchantRefundResourceAcknowledgement, finishMerchantRefundDispatch];
