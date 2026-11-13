// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38: authorized owner recovery, not a public bank-resource oracle.
import { and, desc, eq, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { defineService, ServiceError } from "@/core/service";
import { subscriptionProviderChargeObservations, subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { merchantPaymentObservations, merchantFeeRefunds } from "./merchant-collection-schema";
import { payments } from "./schema";
import { merchantRefundSource } from "./merchant-refund-origin";
import { merchantTaxDigest } from "./merchant-tax-store";
import { merchantCallerLiveness } from "./merchant-physical-caller";
import { originalCashRecoveries } from "./original-cash-recovery-schema";
import { originalCashRecoveryFinancialWitness } from "./original-cash-recovery-store";
import { originalCashRecoveryRevision } from "./original-cash-recovery-current";
import { originalCashPartialReturnCurrent } from "./original-cash-partial-current";
import { merchantRefundRequests, merchantRefundResourceBindings } from "./merchant-refund-schema";
const item = z.object({ recoveryId: z.uuid().nullable(), source: merchantRefundSource, amountMinor: z.number().int().positive(), currency: z.string(), closed: z.boolean(),
  partialPaymentId:z.uuid().nullable(),unassigned:z.array(z.object({operationId:z.uuid(),rawFactId:z.uuid(),providerRef:z.string(),amountMinor:z.number().int().positive(),currency:z.string()})).max(5000),
  partialConfirmed:z.boolean(),confirmedReturnedMinor:z.number().int().min(0),canReturnFull:z.boolean(),
  callers: z.array(z.object({ operationId: z.uuid(), digest: z.string(), callerId: z.uuid(), host: z.string(), pid: z.number().int(), startedAt: z.string(), liveness: z.enum(["live", "absent", "unobservable"]) })),
  legacyFees: z.array(z.object({ id: z.uuid(), digest: z.string() })) });
export const originalCashReturnRecovery = defineService({
  name: "invoicing.originalCashReturnRecovery", summary: "Read retained original cash sources, actual unfinished callers and old fee review debt without exposing credentials or customer metadata.",
  kind: "query", permission: "scoped", input: z.object({}).strict(), output: z.array(item).max(200),
  handler: async (_input, ctx) => {
    const owners = await ctx.tx.select().from(originalCashRecoveries).orderBy(desc(originalCashRecoveries.createdAt), desc(originalCashRecoveries.id)).limit(201);
    if (owners.length > 200) throw new ServiceError("conflict", "The recovery inventory exceeds this complete review window. Restore a bounded original source review before selecting money.");
    const result: z.infer<typeof item>[] = [];
    for (const owner of owners) {
      const witness = await originalCashRecoveryFinancialWitness(ctx.tx, owner.paymentId ? [owner.paymentId] : [], owner.subscriptionChargeReceiptId ? [owner.subscriptionChargeReceiptId] : []);
      const operations = witness.operations.filter(operation => operation.recoveryId === owner.id), facts = witness.facts.filter(fact => fact.recoveryId === owner.id);
      const revision = await originalCashRecoveryRevision(ctx, owner.id);
      const [payment]=owner.paymentId?await ctx.tx.select().from(payments).where(eq(payments.id,owner.paymentId)):[];
      const partial=owner.owner.cash.applied&&payment?await originalCashPartialReturnCurrent(ctx,payment.id):null;
      const returnedReads=operations.filter(operation=>operation.kind==="inspection"&&!operation.request.auxiliaryOperationId&&facts.some(fact=>fact.operationId===operation.id&&fact.kind==="finish"&&fact.evidence.outcome==="returned"));
      const latestRead=returnedReads.sort((a,b)=>Math.max(...facts.filter(fact=>fact.operationId===b.id).map(fact=>fact.sequence))-Math.max(...facts.filter(fact=>fact.operationId===a.id).map(fact=>fact.sequence)))[0];
      const bindings=await ctx.tx.select({ref:merchantRefundResourceBindings.providerRef}).from(merchantRefundResourceBindings).innerJoin(merchantRefundRequests,eq(merchantRefundRequests.id,merchantRefundResourceBindings.requestId))
        .where(and(eq(merchantRefundRequests.providerPlatformAccountId,owner.owner.cash.providerPlatformAccountId),sql`${merchantRefundRequests.chargeAccountId} is not distinct from ${owner.owner.cash.chargeAccountId}`,eq(merchantRefundRequests.originalPaymentRef,owner.owner.cash.providerRef))).limit(5001);
      if(bindings.length>5000)throw new ServiceError("conflict","Restore the complete exact original resource bindings before review.");
      const unassigned=latestRead?facts.filter(fact=>fact.operationId===latestRead.id&&fact.kind==="refund"&&typeof fact.evidence.providerRef==="string"&&!bindings.some(binding=>binding.ref===fact.evidence.providerRef)
        &&["succeeded","failed","canceled"].includes(String(Object.hasOwn(fact.evidence,"providerStatus")?fact.evidence.providerStatus:fact.evidence.status))&&typeof fact.evidence.amountMinor==="number"&&fact.evidence.amountMinor>0&&typeof fact.evidence.currency==="string")
        .map(fact=>({operationId:latestRead.id,rawFactId:fact.id,providerRef:String(fact.evidence.providerRef),amountMinor:Number(fact.evidence.amountMinor),currency:String(fact.evidence.currency)})):[];
      const fees = await ctx.tx.select().from(merchantFeeRefunds).where(or(...(owner.paymentId ? [eq(merchantFeeRefunds.paymentId, owner.paymentId)] : []),
        ...(owner.subscriptionChargeReceiptId ? [eq(merchantFeeRefunds.originalChargeReceiptId, owner.subscriptionChargeReceiptId)] : []))).limit(5001);
      if (fees.length + operations.length + facts.length > 5000) throw new ServiceError("conflict", "Restore the complete original cash-return caller and fee inventory.");
      result.push({ recoveryId: owner.id, source: owner.owner.source, amountMinor: owner.owner.cash.amountMinor, currency: owner.owner.cash.currency,
        partialPaymentId:owner.owner.cash.applied&&payment&&payment.refundedMinor>0?payment.id:null,unassigned,
        partialConfirmed:partial!==null,confirmedReturnedMinor:partial?.customerReturnedMinor??0,canReturnFull:!owner.owner.cash.applied||payment?.refundedMinor===payment?.amountMinor,
        closed: witness.closures.some(closure => closure.recoveryId === owner.id && closure.revision === revision.revision),
        callers: operations.filter(operation => !facts.some(fact => fact.operationId === operation.id && (fact.kind === "finish" || fact.kind === "stop"))).map(operation => ({
          operationId: operation.id, digest: operation.digest, callerId: operation.caller.id, host: operation.caller.host, pid: operation.caller.pid, startedAt: operation.caller.startedAt, liveness: merchantCallerLiveness(operation.caller) })),
        legacyFees: fees.filter(fee => !facts.some(fact => fact.kind === "legacy_fee_stop" && fact.evidence.originalFeeOperationId === fee.id && fact.evidence.originalFeeDigest === merchantTaxDigest(fee))).map(fee => ({ id: fee.id, digest: merchantTaxDigest(fee) })) });
    }
    // Candidates are actual retained positive observations, never an amount
    // search or a reconstructed historical payment. Receipt ownership is exact.
    const subscription = await ctx.tx.select({ receipt: subscriptionProviderChargeReceipts, observation: subscriptionProviderChargeObservations }).from(subscriptionProviderChargeReceipts)
      .innerJoin(subscriptionProviderChargeObservations, and(eq(subscriptionProviderChargeObservations.subscriptionId, subscriptionProviderChargeReceipts.subscriptionId),
        eq(subscriptionProviderChargeObservations.providerPaymentIntentRef, subscriptionProviderChargeReceipts.providerPaymentIntentRef),
        eq(subscriptionProviderChargeObservations.providerPlatformAccountId, subscriptionProviderChargeReceipts.providerPlatformAccountId),
        sql`${subscriptionProviderChargeObservations.chargeAccountId} is not distinct from ${subscriptionProviderChargeReceipts.chargeAccountId}`,
        eq(subscriptionProviderChargeObservations.amountMinor, subscriptionProviderChargeReceipts.amountMinor), eq(subscriptionProviderChargeObservations.currency, subscriptionProviderChargeReceipts.currency)))
      .where(sql`not exists(select 1 from merchant_agreement_payment_routes r join payments p on p.id=r.payment_id where r.original_charge_receipt_id=${subscriptionProviderChargeReceipts.id}
        and p.status='succeeded' and p.provider_ref=${subscriptionProviderChargeReceipts.providerPaymentIntentRef})`).limit(201);
    const payment = await ctx.tx.select({ observation: merchantPaymentObservations,payment:payments }).from(merchantPaymentObservations).innerJoin(payments, eq(payments.id, merchantPaymentObservations.paymentId))
      .where(and(eq(merchantPaymentObservations.status, "succeeded"), or(ne(payments.status, "succeeded"), sql`${payments.providerRef} is distinct from ${merchantPaymentObservations.providerRef}`,
        ne(payments.amountMinor, merchantPaymentObservations.amountMinor), ne(payments.currency, merchantPaymentObservations.currency),
        sql`${payments.refundedMinor}>0`))).limit(201);
    if (subscription.length > 200 || payment.length > 200) throw new ServiceError("conflict", "Restore a bounded actual original cash-source inventory before recovery selection.");
    const sources = [...subscription.filter(({receipt})=>!owners.some(owner=>owner.subscriptionChargeReceiptId===receipt.id)).map(({ receipt, observation }) => ({ source: { kind: "subscription" as const, receiptId: receipt.id, observationId: observation.id }, amountMinor: receipt.amountMinor, currency: receipt.currency,partialPaymentId:null })),
      ...payment.filter(({observation})=>!owners.some(owner=>owner.paymentId===observation.paymentId&&owner.owner.cash.providerRef===observation.providerRef&&owner.owner.cash.providerPlatformAccountId===observation.providerPlatformAccountId&&owner.owner.cash.chargeAccountId===observation.chargeAccountId)).map(({ observation,payment }) => ({ source: { kind: "payment" as const, paymentId: observation.paymentId, observationId: observation.id }, amountMinor: observation.amountMinor, currency: observation.currency,
        partialPaymentId:payment.status==="succeeded"&&payment.providerRef===observation.providerRef&&payment.amountMinor===observation.amountMinor&&payment.currency===observation.currency&&payment.refundedMinor>0?payment.id:null }))];
    for (const source of sources) if (!result.some(row => merchantTaxDigest(row.source) === merchantTaxDigest(source.source))) result.push({ ...source, recoveryId: null, closed: false, callers: [], legacyFees: [],unassigned:[],partialConfirmed:false,confirmedReturnedMinor:0,canReturnFull:source.partialPaymentId===null||payment.some(row=>row.payment.id===source.partialPaymentId&&row.payment.refundedMinor===row.payment.amountMinor) });
    if (result.length > 200) throw new ServiceError("conflict", "The complete original cash recovery list exceeds its safe review window.");
    return result;
  },
});
export default [originalCashReturnRecovery];
