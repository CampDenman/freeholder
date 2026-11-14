// Copyright (C) 2026 Tony Aly
// SPDX-License-Identifier: Apache-2.0
// C12.38/C1.08: financial facts and their durable repair pointer commit together.
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { defineService, ServiceError, type ServiceContext } from "@/core/service";
import { withDeploymentContinuation } from "@/core/runtime/deployment-admission";
import { subscriptionMerchantScopes, subscriptionProviderChargeReceipts } from "@/modules/subscriptions/schema";
import { reconcileMerchantTaxErasureEvidence } from "@/modules/subscriptions/provider-schedule-erasure";
import { merchantAgreementPaymentRoutes } from "./merchant-agreement-schema";
import { invoiceMerchantCollections, merchantPaymentRoutes } from "./merchant-collection-schema";
import { invoiceMerchantScopes, merchantInvoicePaymentRoutes } from "./merchant-invoice-scope-schema";
import { merchantTaxDigest } from "./merchant-tax-store";
import { moneyStateEvents } from "./schema";
import { legacyBankFeedback } from "./legacy-bank-feedback-schema";
import { originalBankFeedbackOwner, originalFeedbackMatchesFrozenSource, type OriginalFeedbackOwner } from "./original-cash-feedback-owner";
import { verifyLegacyReplacementJournalRow } from "./legacy-bank-replacement-store";
import { verifyBankReplacementJournalRow } from "./merchant-bank-replacement-store";
import { controlledCashInspectionLineageWitness } from "@/modules/subscriptions/controlled-cash-inspection-lineage";
import { cashInspectionStops } from "./merchant-cash-inspection-stops";
import { merchantCashReturnInspections } from "./merchant-refund-schema";
import { originalCashRecoveryOwner, originalCashRecoveryFinancialWitness } from "./original-cash-recovery-store";

export const ORIGINAL_REFUND_EVIDENCE_EVENT = "invoicing.originalRefundEvidenceRetained";
const factTypes = {
  original_cash_owner: ["original_cash_recoveries", "id"],
  original_cash_operation: ["original_cash_recovery_operations", "id"],
  original_cash_fact: ["original_cash_recovery_facts", "id"],
  original_cash_closure: ["original_cash_recovery_closures", "id"],
  legacy_bank_feedback: ["legacy_bank_feedback", "id"],
  legacy_bank_replacement: ["money_state_events", "id"],
  legacy_bank_stop: ["legacy_bank_read_stops", "read_id"],
  legacy_bank_current: ["legacy_bank_current_receipts", "id"],
  legacy_bank_read: ["legacy_bank_reads", "id"],
  legacy_bank_fact: ["legacy_bank_read_facts", "id"],
  legacy_bank_finish: ["legacy_bank_read_finishes", "read_id"],
  request: ["merchant_refund_requests", "id"],
  refund_observation: ["merchant_refund_observations", "id"],
  refund_capture: ["merchant_refund_observation_captures", "id"],
  refund_current: ["merchant_refund_current_receipts", "id"],
  bank_replacement: ["money_state_events", "id"],
  refund_ack: ["merchant_refund_resource_bindings", "id"],
  refund_finish: ["merchant_refund_dispatch_finishes", "dispatch_id"],
  refund_retirement: ["merchant_refund_reservation_retirements", "request_id"],
  cash_primary: ["merchant_cash_return_primary_observations", "id"],
  cash_state: ["merchant_cash_return_observations", "id"],
  cash_read: ["merchant_cash_return_inspections", "id"],
  controlled_cash_lineage: ["subscription_controlled_cash_inspection_lineages", "inspection_id"],
  cash_stop: ["merchant_cash_return_inspection_stops", "inspection_id"],
  cash_finish: ["merchant_cash_return_inspection_finishes", "inspection_id"],
  cash_resolution: ["merchant_unapplied_charge_resolutions", "id"],
} as const;
export const originalRefundRepairPointer = z.object({
  kind: z.enum(["original_cash_owner", "original_cash_operation", "original_cash_fact", "original_cash_closure", "legacy_bank_feedback", "legacy_bank_replacement", "legacy_bank_stop", "legacy_bank_current", "legacy_bank_read", "legacy_bank_fact", "legacy_bank_finish", "request", "refund_observation", "refund_capture", "refund_current", "bank_replacement", "refund_ack", "refund_finish", "refund_retirement", "cash_primary", "cash_state", "cash_finish", "cash_stop", "cash_read", "controlled_cash_lineage", "cash_resolution"]),
  id: z.uuid(),
}).strict();
type Pointer = z.infer<typeof originalRefundRepairPointer>;

/** No profile lookup, policy callback or second queue connection may precede
 * the physical fact's commit. The existing transactional outbox owns retry and
 * dead-letter handling after commit, including a crash before first delivery. */
export function queueOriginalMerchantRefundRepair(ctx: ServiceContext, pointer: Pointer): void {
  ctx.queueEvent(ORIGINAL_REFUND_EVIDENCE_EVENT, originalRefundRepairPointer.parse(pointer));
}

async function factRow(ctx: ServiceContext, table: string, column: string, id: string) {
  // Identifiers come exclusively from the constant owned-table map above.
  const rows = await ctx.tx.execute<{ fact: Record<string, unknown> }>(sql`select to_jsonb(f) as fact from ${sql.identifier(table)} f where ${sql.identifier(column)}=${id}::uuid limit 2`);
  if (rows.length !== 1) throw new ServiceError("conflict", "Restore the exact original financial fact before repairing its erasure receipt.");
  return rows[0]!.fact;
}

function restoredId(value: unknown): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new ServiceError("conflict", "Restore the original financial evidence linkage before repairing its erasure receipt.");
  return parsed.data;
}

export const originalMerchantRefundRepairSource = defineService({
  name: "invoicing.originalMerchantRefundRepairSource", summary: "Resolve original financial evidence to its frozen merchant profile without consulting current accounts or email.",
  kind: "query", permission: "system", external: false, input: originalRefundRepairPointer,
  output: z.object({ profileId: z.uuid(), sourceKey: z.string().max(150), evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/) }),
  handler: async (pointer, ctx) => {
    const [table, column] = factTypes[pointer.kind];
    const fact = await factRow(ctx, table, column, pointer.id);
    let owner = fact;
    let originalFeedbackLineage: string | undefined;
    let originalFeedbackNamespace:OriginalFeedbackOwner["namespace"]|undefined;
    if (pointer.kind.startsWith("original_cash_")) {
      const original = await originalCashRecoveryOwner(ctx.tx, pointer.kind === "original_cash_owner" ? pointer.id : restoredId(fact.recovery_id));
      // Validate the entire bounded source-owned set before private financial
      // privacy repair. Corruption is observable outbox debt after fact commit.
      await originalCashRecoveryFinancialWitness(ctx.tx, original.paymentId ? [original.paymentId] : [], original.subscriptionChargeReceiptId ? [original.subscriptionChargeReceiptId] : []);
      owner = { payment_id: original.paymentId, subscription_charge_receipt_id: original.subscriptionChargeReceiptId };
    } else if (pointer.kind === "legacy_bank_feedback") {
      const [raw] = await ctx.tx.select().from(legacyBankFeedback).where(eq(legacyBankFeedback.id, pointer.id));
      if (!raw) throw new ServiceError("conflict", "Restore the authentic original raw bank-feedback receipt before privacy repair.");
      const original = await originalBankFeedbackOwner(ctx.tx, raw);
      owner = { payment_id: original.paymentId, subscription_charge_receipt_id: original.subscriptionChargeReceiptId };
      originalFeedbackLineage = original.lineageDigest;
      originalFeedbackNamespace=original.namespace;
    } else if (pointer.kind === "legacy_bank_replacement") {
      const [journal] = await ctx.tx.select().from(moneyStateEvents).where(eq(moneyStateEvents.id, pointer.id));
      const body = journal && verifyLegacyReplacementJournalRow(journal);
      if (!body) throw new ServiceError("conflict", "Restore the authentic exact original legacy replacement receipt before financial privacy repair.");
      owner = { payment_id: body.paymentId, subscription_charge_receipt_id: null };
    } else if (pointer.kind === "legacy_bank_stop" || pointer.kind === "legacy_bank_current" || pointer.kind === "legacy_bank_read" || pointer.kind === "legacy_bank_fact" || pointer.kind === "legacy_bank_finish") {
      const read = pointer.kind === "legacy_bank_read" ? fact : await factRow(ctx, "legacy_bank_reads", "id", restoredId(fact.read_id));
      const original = read.original;
      if (!original || typeof original !== "object" || merchantTaxDigest(original) !== read.original_digest) throw new ServiceError("conflict", "Restore the authentic original legacy read owner before repairing its financial privacy evidence.");
      const identity = original as Record<string, unknown>;
      owner = { payment_id: restoredId(identity.paymentId), subscription_charge_receipt_id: null };
    } else if (pointer.kind === "bank_replacement") {
      const [journal] = await ctx.tx.select().from(moneyStateEvents).where(eq(moneyStateEvents.id, pointer.id));
      const body = journal && verifyBankReplacementJournalRow(journal);
      if (!body) throw new ServiceError("conflict", "Restore the exact original bank replacement receipt before repairing its erasure evidence.");
      owner = await factRow(ctx, "merchant_refund_requests", "id", body.rootRequestId);
      if (owner.request_digest !== body.rootRequestDigest) throw new ServiceError("conflict", "Restore the original signed replacement's frozen financial owner.");
    } else if (pointer.kind === "refund_capture") {
      owner = await factRow(ctx, "merchant_refund_observations", "id", restoredId(fact.observation_id));
    } else if (pointer.kind === "refund_current") {
      owner = await factRow(ctx, "merchant_refund_requests", "id", restoredId(fact.request_id));
    } else if (pointer.kind === "refund_finish") {
      const dispatch = await factRow(ctx, "merchant_refund_dispatches", "id", pointer.id);
      owner = await factRow(ctx, "merchant_refund_requests", "id", restoredId(dispatch.request_id));
    } else if (pointer.kind === "refund_ack" || pointer.kind === "refund_retirement") {
      owner = await factRow(ctx, "merchant_refund_requests", "id", restoredId(fact.request_id));
    } else if (["cash_primary", "cash_state", "cash_finish", "cash_stop", "controlled_cash_lineage"].includes(pointer.kind)) {
      owner = await factRow(ctx, "merchant_cash_return_inspections", "id", restoredId(fact.inspection_id));
    }
    if(pointer.kind==="cash_stop"){
      const[admission]=await ctx.tx.select().from(merchantCashReturnInspections).where(eq(merchantCashReturnInspections.id,pointer.id));
      if(!admission||(await cashInspectionStops(ctx.tx,[admission])).length!==1)throw new ServiceError("conflict","Restore the authentic exact stopped-inspection receipt before privacy repair.");
    }
    if(pointer.kind==="controlled_cash_lineage"){
      const receiptId=restoredId(fact.receipt_id),resourceId=restoredId(fact.resource_id);
      const witness=await controlledCashInspectionLineageWitness(ctx.tx,{receiptIds:[receiptId],resourceIds:[resourceId]});
      if(!witness.lineages.some(row=>row.inspectionId===pointer.id&&row.receiptId===receiptId&&row.resourceId===resourceId))throw new ServiceError("conflict","Restore the authentic original admission lineage before private financial erasure repair.");
    }
    const paymentId = owner.payment_id === null ? null : restoredId(owner.payment_id), receiptId = owner.subscription_charge_receipt_id === null ? null : restoredId(owner.subscription_charge_receipt_id);
    if ((paymentId === null) === (receiptId === null)) throw new ServiceError("conflict", "Restore the one actual original financial owner before erasure repair.");
    const profiles: string[] = [];
    if (paymentId) {
      const orders = await ctx.tx.select({ policy: invoiceMerchantCollections.taxPolicy,platform:invoiceMerchantCollections.providerPlatformAccountId,account:invoiceMerchantCollections.chargeAccountId }).from(merchantPaymentRoutes)
        .innerJoin(invoiceMerchantCollections, eq(invoiceMerchantCollections.allocationId, merchantPaymentRoutes.allocationId)).where(eq(merchantPaymentRoutes.paymentId, paymentId)).limit(2);
      const bookings = await ctx.tx.select({ policy: invoiceMerchantScopes.taxPolicy,platform:invoiceMerchantScopes.providerPlatformAccountId,account:invoiceMerchantScopes.chargeAccountId }).from(merchantInvoicePaymentRoutes)
        .innerJoin(invoiceMerchantScopes, eq(invoiceMerchantScopes.invoiceId, merchantInvoicePaymentRoutes.invoiceId)).where(eq(merchantInvoicePaymentRoutes.paymentId, paymentId)).limit(2);
      const agreements = await ctx.tx.select({ profileId: subscriptionMerchantScopes.taxProfileId,platform:subscriptionMerchantScopes.providerPlatformAccountId,account:subscriptionMerchantScopes.chargeAccountId,routePlatform:merchantAgreementPaymentRoutes.providerPlatformAccountId,routeAccount:merchantAgreementPaymentRoutes.chargeAccountId }).from(merchantAgreementPaymentRoutes)
        .innerJoin(subscriptionMerchantScopes, eq(subscriptionMerchantScopes.subscriptionId, merchantAgreementPaymentRoutes.subscriptionId)).where(eq(merchantAgreementPaymentRoutes.paymentId, paymentId)).limit(2);
      if(originalFeedbackNamespace&&([...orders,...bookings,...agreements].some(source=>!originalFeedbackMatchesFrozenSource(originalFeedbackNamespace,source))
        ||agreements.some(source=>!originalFeedbackMatchesFrozenSource(originalFeedbackNamespace,{platform:source.routePlatform,account:source.routeAccount}))))throw new ServiceError("conflict","Retain authenticated foreign or mismatched cash as debt; its original namespace does not belong to this frozen merchant source.");
      profiles.push(...orders.map(row => row.policy.profileId), ...bookings.map(row => row.policy.profileId), ...agreements.map(row => row.profileId));
    } else {
      const rows = await ctx.tx.select({ profileId: subscriptionMerchantScopes.taxProfileId,platform:subscriptionMerchantScopes.providerPlatformAccountId,account:subscriptionMerchantScopes.chargeAccountId,receiptPlatform:subscriptionProviderChargeReceipts.providerPlatformAccountId,receiptAccount:subscriptionProviderChargeReceipts.chargeAccountId }).from(subscriptionProviderChargeReceipts)
        .innerJoin(subscriptionMerchantScopes, eq(subscriptionMerchantScopes.subscriptionId, subscriptionProviderChargeReceipts.subscriptionId))
        .where(and(eq(subscriptionProviderChargeReceipts.id, receiptId!))).limit(2);
      if(originalFeedbackNamespace&&rows.some(source=>!originalFeedbackMatchesFrozenSource(originalFeedbackNamespace,source)
        ||!originalFeedbackMatchesFrozenSource(originalFeedbackNamespace,{platform:source.receiptPlatform,account:source.receiptAccount})))throw new ServiceError("conflict","Restore the exact receipt's frozen original merchant scope before privacy repair; a different platform/account remains debt.");
      profiles.push(...rows.map(row => row.profileId));
    }
    if (profiles.length !== 1 || !z.uuid().safeParse(profiles[0]).success) throw new ServiceError("conflict", "The exact original merchant scope is missing or ambiguous; retain the financial fact and restore its scope before receipt repair.");
    // Operational insertion timestamps are not evidence versions. Actual
    // semantic fields, private caller proof and immutable source IDs remain.
    const evidence = Object.fromEntries(Object.entries(fact).filter(([key]) => !key.endsWith("_at")));
    return { profileId: profiles[0]!, sourceKey: `financial:${pointer.kind}:${pointer.id}`, evidenceDigest: merchantTaxDigest({ ...pointer, evidence, ...(originalFeedbackLineage ? { originalFeedbackLineage } : {}) }) };
  },
});

/** Manifest-registered outbox listener; both calls occur AFTER source commit. */
export async function onOriginalMerchantRefundEvidence(payload: unknown): Promise<void> {
  const source = await originalMerchantRefundRepairSource.call(originalRefundRepairPointer.parse(payload), { kind: "system" });
  // An actual durable fact is already admitted. Cleanup may continue during
  // draining; the core helper still refuses new queue work after a seal.
  await withDeploymentContinuation(async () => {
    const result = await reconcileMerchantTaxErasureEvidence.call(source, { kind: "system" });
    if (result.recoveryRequired) throw new ServiceError("conflict", "Restore the exact original erasure receipt; the financial evidence remains committed.");
  });
}

export default [originalMerchantRefundRepairSource];
