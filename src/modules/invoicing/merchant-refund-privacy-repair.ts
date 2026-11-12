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

export const ORIGINAL_REFUND_EVIDENCE_EVENT = "invoicing.originalRefundEvidenceRetained";
const factTypes = {
  request: ["merchant_refund_requests", "id"],
  refund_observation: ["merchant_refund_observations", "id"],
  refund_capture: ["merchant_refund_observation_captures", "id"],
  refund_current: ["merchant_refund_current_receipts", "id"],
  refund_ack: ["merchant_refund_resource_bindings", "id"],
  refund_finish: ["merchant_refund_dispatch_finishes", "dispatch_id"],
  refund_retirement: ["merchant_refund_reservation_retirements", "request_id"],
  cash_primary: ["merchant_cash_return_primary_observations", "id"],
  cash_state: ["merchant_cash_return_observations", "id"],
  cash_finish: ["merchant_cash_return_inspection_finishes", "inspection_id"],
  cash_resolution: ["merchant_unapplied_charge_resolutions", "id"],
} as const;
export const originalRefundRepairPointer = z.object({
  kind: z.enum(["request", "refund_observation", "refund_capture", "refund_current", "refund_ack", "refund_finish", "refund_retirement", "cash_primary", "cash_state", "cash_finish", "cash_resolution"]),
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
    if (pointer.kind === "refund_capture") {
      owner = await factRow(ctx, "merchant_refund_observations", "id", restoredId(fact.observation_id));
    } else if (pointer.kind === "refund_current") {
      owner = await factRow(ctx, "merchant_refund_requests", "id", restoredId(fact.request_id));
    } else if (pointer.kind === "refund_finish") {
      const dispatch = await factRow(ctx, "merchant_refund_dispatches", "id", pointer.id);
      owner = await factRow(ctx, "merchant_refund_requests", "id", restoredId(dispatch.request_id));
    } else if (pointer.kind === "refund_ack" || pointer.kind === "refund_retirement") {
      owner = await factRow(ctx, "merchant_refund_requests", "id", restoredId(fact.request_id));
    } else if (["cash_primary", "cash_state", "cash_finish"].includes(pointer.kind)) {
      owner = await factRow(ctx, "merchant_cash_return_inspections", "id", restoredId(fact.inspection_id));
    }
    const paymentId = owner.payment_id === null ? null : restoredId(owner.payment_id), receiptId = owner.subscription_charge_receipt_id === null ? null : restoredId(owner.subscription_charge_receipt_id);
    if ((paymentId === null) === (receiptId === null)) throw new ServiceError("conflict", "Restore the one actual original financial owner before erasure repair.");
    const profiles: string[] = [];
    if (paymentId) {
      const orders = await ctx.tx.select({ policy: invoiceMerchantCollections.taxPolicy }).from(merchantPaymentRoutes)
        .innerJoin(invoiceMerchantCollections, eq(invoiceMerchantCollections.allocationId, merchantPaymentRoutes.allocationId)).where(eq(merchantPaymentRoutes.paymentId, paymentId)).limit(2);
      const bookings = await ctx.tx.select({ policy: invoiceMerchantScopes.taxPolicy }).from(merchantInvoicePaymentRoutes)
        .innerJoin(invoiceMerchantScopes, eq(invoiceMerchantScopes.invoiceId, merchantInvoicePaymentRoutes.invoiceId)).where(eq(merchantInvoicePaymentRoutes.paymentId, paymentId)).limit(2);
      const agreements = await ctx.tx.select({ profileId: subscriptionMerchantScopes.taxProfileId }).from(merchantAgreementPaymentRoutes)
        .innerJoin(subscriptionMerchantScopes, eq(subscriptionMerchantScopes.subscriptionId, merchantAgreementPaymentRoutes.subscriptionId)).where(eq(merchantAgreementPaymentRoutes.paymentId, paymentId)).limit(2);
      profiles.push(...orders.map(row => row.policy.profileId), ...bookings.map(row => row.policy.profileId), ...agreements.map(row => row.profileId));
    } else {
      const rows = await ctx.tx.select({ profileId: subscriptionMerchantScopes.taxProfileId }).from(subscriptionProviderChargeReceipts)
        .innerJoin(subscriptionMerchantScopes, eq(subscriptionMerchantScopes.subscriptionId, subscriptionProviderChargeReceipts.subscriptionId))
        .where(and(eq(subscriptionProviderChargeReceipts.id, receiptId!))).limit(2);
      profiles.push(...rows.map(row => row.profileId));
    }
    if (profiles.length !== 1 || !z.uuid().safeParse(profiles[0]).success) throw new ServiceError("conflict", "The exact original merchant scope is missing or ambiguous; retain the financial fact and restore its scope before receipt repair.");
    // Operational insertion timestamps are not evidence versions. Actual
    // semantic fields, private caller proof and immutable source IDs remain.
    const evidence = Object.fromEntries(Object.entries(fact).filter(([key]) => !key.endsWith("_at")));
    return { profileId: profiles[0]!, sourceKey: `financial:${pointer.kind}:${pointer.id}`, evidenceDigest: merchantTaxDigest({ ...pointer, evidence }) };
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
